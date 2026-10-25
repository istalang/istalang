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
 * - An assignment evaluates its value, then writes each part to its place (`assignedOf`);
 *   `x$ = v` calls the function the checker resolved for it on the handle and the value. A
 *   compound assignment reads its place once, calls its operator's function on that value and the
 *   operand, and writes the result back to the same place.
 * - A place reached through `x$` is changed in the value `unwrap` reads, which `rewrap` then
 *   writes back (§3.9), around the write the place takes.
 */

import type { Place } from '../../../definition/instructions/places.ts';
import type { Register, TypeId } from '../../../definition/operands.ts';
import type { Span } from '../../../text/span.ts';
import type { TargetOwner } from '../../checker/check.ts';
import type { Type } from '../../checker/types/type.ts';
import { type Expression, placePath } from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { Assignment, VariableDeclaration } from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { call, implicitCall } from '../expressions/calls.ts';
import { pathOf, placeOf, readPart, readPlace, writePlace } from '../places.ts';

/** A register holding a cell, and the `Shared<T>` type entry it is created as. */
export interface CellRegister {
  readonly register: Register;
  readonly type: TypeId;
}

/**
 * The register each variable of one body lives in, by its declaring name, which are cells, and
 * which the open blocks declared: what each releases when it ends (statements.ts).
 */
export class VariableRegisters {
  readonly #registers = new Map<Identifier, Register>();
  readonly #cells: CellRegister[] = [];
  /** The registers each open block declared, outermost first. */
  readonly #blocks: Register[][] = [];

  declare(declaring: Identifier, register: Register): void {
    this.#registers.set(declaring, register);
    this.#blocks.at(-1)?.push(register);
  }

  /** Runs `lower` as a block of its own; what it gave, and the registers it declared. */
  inBlock<Result>(lower: () => Result): {
    readonly result: Result;
    readonly declared: readonly Register[];
  } {
    const declared: Register[] = [];
    this.#blocks.push(declared);
    try {
      return { result: lower(), declared };
    } finally {
      this.#blocks.pop();
    }
  }

  /** How many blocks are open: where a loop's body starts, for leaving it. */
  get depth(): number {
    return this.#blocks.length;
  }

  /** The registers the blocks opened since `depth` declared, innermost block first. */
  declaredSince(depth: number): readonly Register[] {
    return this.#blocks.slice(depth).reverse().flat();
  }

  registerOf(declaring: Identifier): Register {
    const register = this.#registers.get(declaring);
    if (register === undefined) {
      throw new Error(`'${declaring.text}' has no register; the checker let an unknown name by.`);
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
): Register {
  const register = context.code.allocate();
  if (context.body.inCell(declaring)) {
    context.variables.addCell({ register, type: cellTypeIndex(context, type) });
  }
  context.variables.declare(declaring, register);
  return register;
}

export function lowerVariableDeclaration(
  context: FunctionContext,
  node: VariableDeclaration,
): void {
  bindTargets(context, node, context.expression(node.initializer), node.span);
}

/** Declares each name `owner`'s targets bind, moving in its part of `value` (§3.15). */
export function bindTargets(
  context: FunctionContext,
  owner: TargetOwner,
  value: Register,
  span: Span,
): void {
  for (const binding of context.body.targetsOf(owner)) {
    const part = readPart(context, value, binding.path, span);
    const register = declareVariable(context, binding.name, binding.type);
    context.code.emit({ kind: 'move', span, dst: register, src: part });
  }
}

export function lowerAssignment(context: FunctionContext, node: Assignment): void {
  const [first, ...more] = node.targets;
  if (more.length === 0 && node.operator === '=' && first?.kind === 'Unwrap') {
    const handle = context.expression(first.operand);
    call(context, node, [handle, context.expression(node.value)]);
    return;
  }
  const parts = context.body.assignedOf(node);
  const [only] = parts;
  if (node.operator !== '=' && only !== undefined) {
    changingPlace(context, only.target, (place) => lowerCompound(context, node, place));
    return;
  }
  const value = context.expression(node.value);
  for (const { target, path } of parts) {
    changingPlace(context, target, (place) => {
      writePlace(context, place, readPart(context, value, path, node.span), node.span);
    });
  }
}

/** `x op= v` at `place`: its value read once, the operator's function called, the result written. */
function lowerCompound(context: FunctionContext, node: Assignment, place: Place): void {
  if (place.path.length === 0) {
    call(context, node, [place.register, context.expression(node.value)], place.register);
    return;
  }
  const current = readPlace(context, place, node.span);
  const result = call(context, node, [current, context.expression(node.value)]);
  writePlace(context, place, result, node.span);
}

/**
 * Lets `change` write the place `node` names. A place reached through `x$` (§3.9) is the value
 * `unwrap` read, in a register of its own; once changed, the `rewrap` the checker made for the
 * `x$` writes it back through the same handle.
 */
function changingPlace(
  context: FunctionContext,
  node: Expression,
  change: (place: Place) => void,
): void {
  const { root, steps } = placePath(node);
  if (root.kind !== 'Unwrap') {
    change(placeOf(context, node));
    return;
  }
  const handle = context.expression(root.operand);
  const value = call(context, root, [handle]);
  change({ register: value, path: pathOf(context, steps) });
  implicitCall(context, root, 'write', [handle, value]);
}

/** The `Shared<T>` entry a cell holding a `type` is created as. */
export function cellTypeIndex(context: FunctionContext, type: Type): TypeId {
  return context.tables.typeIndex(context.checker.sharedOf(type));
}
