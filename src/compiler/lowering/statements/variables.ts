/**
 * Declaring and assigning variables (§3.4, §3.15).
 *
 * - A variable gets a register of its own, and its value is moved in: values are copied when
 *   assigned (§3.1), and the value's register may belong to another variable. A declaration's
 *   targets take the value apart as the checker found (`targetsOf`), each name's part read along
 *   its path.
 * - A variable passed by `&` somewhere in the body, or a `let` a closure captures, lives in a cell,
 *   which a reference or a closure can reach (docs/arch/definition.md, "Frames"): its register is
 *   listed in the function's `cells`, typed as the `Shared<T>` the cell is created as.
 * - An assignment evaluates its value, then writes each part to its place (`assignedOf`),
 *   wrapped as the checker found it fits the place (§2); a whole `x$`, like a last element, is
 *   written with its write call alone (places.ts). A compound assignment reads its place once, calls its operator's function on that value and the
 *   operand, and writes the result back to the same place. A place reached through an element or
 *   a `x$` is copied in and written back around the write (places.ts).
 * - A value given to `_` is held until the block ends (§7), so an unnamed target keeps the whole
 *   value in a variable of its own, with no name. A `fn let`, `fn const` or `fn _` variable lasts
 *   until the function returns (§3.4): its block keeps it (`keep`) before releasing its register.
 */

import type { Register, TypeId } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Span } from '../../../text/span.ts';
import type { AssignedPart, TargetOwner } from '../../checker/check.ts';
import type { Type } from '../../checker/types/type.ts';
import type { Identifier } from '../../syntax/node.ts';
import { hasUnnamedPart } from '../../syntax/patterns.ts';
import {
  type Assignment,
  hasUnnamedTarget,
  type VariableDeclaration,
} from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { call } from '../expressions/calls.ts';
import {
  cellRegister,
  enterAssigned,
  type PlaceTarget,
  readPart,
  readTarget,
  writeTarget,
} from '../places.ts';

/** A register holding a cell, and the `Shared<T>` type entry it is created as. */
export interface CellRegister {
  readonly register: Register;
  readonly type: TypeId;
}

/** How long what a variable holds lasts: until its block ends, or until its function returns. */
export type Lifetime = 'block' | 'function';

/**
 * What one block declared (§3.4): every register a variable of it lives in, which its end
 * releases, and those of them whose holdings last until the function returns, which it keeps first.
 */
export interface BlockScope {
  readonly declared: readonly Register[];
  readonly kept: readonly Register[];
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
  readonly #blocks: { readonly declared: Register[]; readonly kept: Register[] }[] = [];

  declare(declaring: Identifier, register: Register, lifetime: Lifetime = 'block'): void {
    this.#registers.set(declaring, register);
    this.hold(register, lifetime);
  }

  /**
   * Makes `register` a variable of the innermost block with no name: what `_` keeps, a `defer`
   * guard, the holdings of a `select`'s winning case (§7, §8).
   */
  hold(register: Register, lifetime: Lifetime = 'block'): void {
    this.#variables.add(register);
    const block = this.#blocks.at(-1);
    block?.declared.push(register);
    if (lifetime === 'function') {
      block?.kept.push(register);
    }
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
    context.variables.hold(copied(context, value, node.span), lifetimeOf(node));
  }
  bindTargets(context, node, value, node.span);
}

/** How long what `owner`'s targets hold lasts: a `fn let`'s, `fn const`'s or `fn _`'s, its function's. */
function lifetimeOf(owner: TargetOwner): Lifetime {
  return owner.kind === 'VariableDeclaration' && owner.heldByFunction ? 'function' : 'block';
}

/** Declares each name `owner`'s targets bind, moving in its part of `value` (§3.15). */
export function bindTargets(
  context: FunctionContext,
  owner: TargetOwner,
  value: Register,
  span: Span,
): void {
  const lifetime = lifetimeOf(owner);
  for (const binding of context.body.targetsOf(owner)) {
    const part = readPart(context, value, binding.path, span);
    const register = declareVariable(context, binding.name, binding.type, lifetime);
    context.code.emit({ kind: 'move', span, dst: register, src: part });
  }
}

/** A fresh register holding a copy of `value`, as a variable with no name keeps it (§7). */
function copied(context: FunctionContext, value: Register, span: Span): Register {
  const copy = context.code.allocate();
  context.code.emit({ kind: 'move', span, dst: copy, src: value });
  return copy;
}

export function lowerAssignment(context: FunctionContext, node: Assignment): void {
  const parts = context.body.assignedOf(node);
  const [only] = parts;
  if (node.operator !== '=' && only !== undefined) {
    const { target, leave } = enterAssigned(context, only.target);
    lowerCompound(context, node, target, only);
    leave();
    return;
  }
  const value = context.expression(node.value);
  if (node.targets.some(hasUnnamedTarget)) {
    context.variables.hold(copied(context, value, node.span));
  }
  for (const part of parts) {
    const { target, leave } = enterAssigned(context, part.target);
    const read = readPart(context, value, part.path, node.span);
    writeTarget(context, target, writtenPart(context, read, part, node.span), node.span);
    leave();
  }
}

/** `x op= v` at `target`: its value read once, the operator's function called, the result written. */
function lowerCompound(
  context: FunctionContext,
  node: Assignment,
  target: PlaceTarget,
  part: AssignedPart,
): void {
  const current = readTarget(context, target, node.span);
  const result = call(context, node, [current, context.expression(node.value)]);
  writeTarget(context, target, writtenPart(context, result, part, node.span), node.span);
}

/** `value`, the part of an assignment's value `part` writes, wrapped to fit its place (§2). */
function writtenPart(
  context: FunctionContext,
  value: Register,
  part: AssignedPart,
  span: Span,
): Register {
  return context.wrapped(value, part.type, part.wraps, span);
}
