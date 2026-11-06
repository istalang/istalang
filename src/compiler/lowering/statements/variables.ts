/**
 * Declaring and assigning variables (§3.4, §3.15).
 *
 * - A variable gets a register of its own, and its value is moved in: values are copied when
 *   assigned (§3.1), and the value's register may belong to another variable. A declaration's
 *   targets take the value apart as the checker found (`targetsOf`), each name's part read along
 *   its path.
 * - A variable passed by `&` somewhere in the body, or a `let` a closure captures, lives in a cell,
 *   which a reference or a closure can reach (docs/arch/definition.md, "Frames"): its register is
 *   listed in the function's `cells`, typed as the `_Cell<T>` the cell is created as.
 * - An assignment evaluates its value, then writes each part to its place (`assignedOf`),
 *   wrapped as the checker found it fits the place (§2); a whole `*x`, like a last element, is
 *   written with its write alone (places.ts). A compound assignment reads its place once, calls
 *   its operator's function on that value and the operand, and writes the result back to the same
 *   place. A place reached through an element or a shared struct's value is copied in and written
 *   back around the write (places.ts).
 * - A value given to `_` is held until the block ends (§7), so an unnamed target keeps the whole
 *   value in a variable of its own, with no name. A `hold let`, `hold const` or `hold _` variable
 *   lasts until its hold scope ends (§3.4): its block keeps it (`keep`) into that scope's list
 *   (holds.ts) before releasing its register.
 */

import type { Register, TypeId } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { AssignedPart } from '../../checker/surface/checked-body.ts';
import type { TargetOwner } from '../../checker/surface/checked-pattern.ts';
import type { Type } from '../../checker/types/type.ts';
import type { Identifier } from '../../syntax/node.ts';
import { hasUnnamedPart } from '../../syntax/patterns.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import {
  type Assignment,
  hasUnnamedTarget,
  type VariableDeclaration,
} from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { emitCallAt } from '../emit-call.ts';
import { readPartAlong } from '../part-paths.ts';
import { type AssignedPlace, cellRegister, enterAssigned } from '../places.ts';

/** A register holding a cell, and the `_Cell<T>` type entry it is created as. */
export interface CellRegister {
  readonly register: Register;
  readonly type: TypeId;
}

/**
 * How long what a variable holds lasts: until its block ends, or until the hold scope ends whose
 * list is `into` (holds.ts).
 */
export type Lifetime = 'block' | { readonly into: Register };

/** A held variable's register, and the list its block's end keeps what it holds into. */
export interface Kept {
  readonly register: Register;
  readonly into: Register;
}

/**
 * What one block declared (§3.4): every register a variable of it lives in, which its end
 * releases, and those of them whose holdings last longer, which it keeps first.
 */
export interface BlockScope {
  readonly declared: readonly Register[];
  readonly kept: readonly Kept[];
}

/**
 * The register each variable of one body lives in, by its declaring name, which are cells, and
 * which the open blocks declared: what each releases when it ends (statements.ts). Registers no
 * variable lives in are temporaries, released at the end of their statement, each once.
 */
export class VariableRegisters {
  readonly #registers = new Map<Identifier, Register>();
  readonly #variables = new Set<Register>();
  readonly #released = new Set<Register>();
  readonly #cells: CellRegister[] = [];
  /** What each open block declared, outermost first. */
  readonly #blocks: { readonly declared: Register[]; readonly kept: Kept[] }[] = [];

  declare(declaring: Identifier, register: Register, lifetime: Lifetime = 'block'): void {
    this.#registers.set(declaring, register);
    this.declareUnnamed(register, lifetime);
  }

  /**
   * Makes `register` a variable of the innermost block with no name: what `_` keeps, a `defer`
   * guard, the holdings of a `select`'s winning case, a hold scope's list (§7, §8).
   */
  declareUnnamed(register: Register, lifetime: Lifetime = 'block'): void {
    this.#variables.add(register);
    const block = this.#blocks.at(-1);
    block?.declared.push(register);
    if (lifetime !== 'block') {
      block?.kept.push({ register, into: lifetime.into });
    }
  }

  /**
   * Makes `register` a variable of the function's own body, which no block releases and only the
   * function's return does: the list of what lasts until then (holds.ts).
   */
  declareFunctionWide(register: Register): void {
    this.#variables.add(register);
  }

  /** Runs `lower` as a block of its own; what it gave, and what it declared. */
  inBlock<Result>(lower: () => Result): { readonly result: Result; readonly scope: BlockScope } {
    const scope = { declared: [], kept: [] };
    this.#blocks.push(scope);
    try {
      return { result: lower(), scope };
    } finally {
      this.#blocks.pop();
    }
  }

  /** How many blocks are open: where a loop's body starts, for leaving it. */
  get depth(): number {
    return this.#blocks.length;
  }

  /** What the blocks opened since `depth` declared, innermost block first. */
  scopeSince(depth: number): BlockScope {
    const left = this.#blocks.slice(depth).reverse();
    return {
      declared: left.flatMap((block) => block.declared),
      kept: left.flatMap((block) => block.kept),
    };
  }

  /** Those of `registers` no variable lives in and nothing released yet, now counted released. */
  temporariesAmong(registers: readonly Register[]): readonly Register[] {
    const temporaries = registers.filter(
      (register) => !(this.#variables.has(register) || this.#released.has(register)),
    );
    for (const register of temporaries) {
      this.#released.add(register);
    }
    return temporaries;
  }

  registerOf(declaring: Identifier): Register {
    const register = this.#registers.get(declaring);
    if (register === undefined) {
      unreachable(`'${declaring.text}' has no register; the checker let an unknown name by.`);
    }
    return register;
  }

  addCell(cell: CellRegister): void {
    this.#cells.push(cell);
  }

  get cells(): readonly CellRegister[] {
    return this.#cells;
  }
}

/** A fresh register for the variable `declaring` declares, of `type`; a cell if it lives in one. */
export function declareVariable(
  context: FunctionContext,
  declaring: Identifier,
  type: Type,
  lifetime: Lifetime = 'block',
): Register {
  const register = context.body.inCell(declaring)
    ? cellRegister(context, type)
    : context.code.allocate();
  context.variables.declare(declaring, register, lifetime);
  return register;
}

export function lowerVariableDeclaration(
  context: FunctionContext,
  node: VariableDeclaration,
): void {
  const value = context.expression(node.initializer);
  if (node.targets.some(hasUnnamedPart)) {
    context.variables.declareUnnamed(copied(context, value, node.span), lifetimeOf(context, node));
  }
  bindTargets(context, node, value, node.span);
}

/** How long what `owner`'s targets hold lasts: a `hold`'s, until its hold scope ends. */
function lifetimeOf(context: FunctionContext, owner: TargetOwner): Lifetime {
  return owner.kind === 'VariableDeclaration' && owner.hold !== undefined
    ? { into: context.holds.listOf(owner.hold) }
    : 'block';
}

/** Declares each name `owner`'s targets bind, moving in its part of `value` (§3.15). */
export function bindTargets(
  context: FunctionContext,
  owner: TargetOwner,
  value: Register,
  span: AnchoredSpan,
): void {
  const lifetime = lifetimeOf(context, owner);
  for (const binding of context.body.targetsOf(owner)) {
    const part = readPartAlong(context, value, binding.path, span);
    const register = declareVariable(context, binding.name, binding.type, lifetime);
    context.code.emit({ kind: 'move', span, dst: register, src: part });
  }
}

/** A fresh register holding a copy of `value`, as a variable with no name keeps it (§7). */
function copied(context: FunctionContext, value: Register, span: AnchoredSpan): Register {
  const copy = context.code.allocate();
  context.code.emit({ kind: 'move', span, dst: copy, src: value });
  return copy;
}

export function lowerAssignment(context: FunctionContext, node: Assignment): void {
  const stopsAt = context.body.stopsAt(node);
  if (stopsAt !== undefined) {
    for (const operand of stopsAt) {
      context.expression(operand);
    }
    return;
  }
  const parts = context.body.assignedOf(node);
  const [only] = parts;
  if (node.operator !== '=' && only !== undefined) {
    lowerCompound(context, node, enterAssigned(context, only.target), only);
    return;
  }
  const value = context.expression(node.value);
  if (node.targets.some(hasUnnamedTarget)) {
    context.variables.declareUnnamed(copied(context, value, node.span));
  }
  for (const part of parts) {
    const place = enterAssigned(context, part.target);
    const read = readPartAlong(context, value, part.path, node.span);
    place.write({ register: read, type: part.type }, part.fit, node.span);
  }
}

/**
 * `x op= v` at `place`: read before `v` is computed, the operator's function called, the result
 * written as `x = x op v` writes it (§3.9).
 */
function lowerCompound(
  context: FunctionContext,
  node: Assignment,
  place: AssignedPlace,
  part: AssignedPart,
): void {
  const current = place.read(node.span);
  const result = emitCallAt(context, node, [current, context.expression(node.value)]);
  place.write({ register: result, type: part.type }, part.fit, node.span);
}
