/**
 * Declaring and assigning variables (§3.4, §3.15).
 *
 * - A variable gets a register of its own, and its value is moved in: values are copied when
 *   assigned (§3.1), and the value's register may belong to another variable. A declaration's
 *   targets take the value apart as the checker found (`targetsOf`), each name's part read along
 *   its path.
 * - A variable passed by `&` somewhere in the body lives in a cell, which a reference can reach
 *   (docs/arch/definition.md, "Frames"): its register is listed in the function's `cells`, typed
 *   as the `Shared<T>` the cell is created as.
 * - An assignment evaluates its value, then writes each part to its place (`assignedOf`);
 *   `x$ = v` calls the function the checker resolved for it on the handle and the value. A
 *   compound assignment reads its place once, calls its operator's function on that value and the
 *   operand, and writes the result back to the same place.
 */

import type { Register, TypeId } from '../../../definition/operands.ts';
import type { Span } from '../../../text/span.ts';
import type { TargetOwner } from '../../checker/check.ts';
import type { Type } from '../../checker/types/type.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { Assignment, VariableDeclaration } from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { call } from '../expressions/calls.ts';
import { placeOf, readPart, readPlace, writePlace } from '../places.ts';

/** A register holding a cell, and the `Shared<T>` type entry it is created as. */
export interface CellRegister {
  readonly register: Register;
  readonly type: TypeId;
}

/** The register each variable of one body lives in, by its declaring name, and which are cells. */
export class VariableRegisters {
  readonly #registers = new Map<Identifier, Register>();
  readonly #cells: CellRegister[] = [];

  declare(declaring: Identifier, register: Register): void {
    this.#registers.set(declaring, register);
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

/** A fresh register for the variable `declaring` declares, of `type`; a cell if it is referenced. */
export function declareVariable(
  context: FunctionContext,
  declaring: Identifier,
  type: Type,
): Register {
  const register = context.code.allocate();
  if (context.body.isReferenced(declaring)) {
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
    const place = placeOf(context, only.target);
    if (place.path.length === 0) {
      call(context, node, [place.register, context.expression(node.value)], place.register);
      return;
    }
    const current = readPlace(context, place, node.span);
    const result = call(context, node, [current, context.expression(node.value)]);
    writePlace(context, place, result, node.span);
    return;
  }
  const value = context.expression(node.value);
  for (const { target, path } of parts) {
    writePlace(
      context,
      placeOf(context, target),
      readPart(context, value, path, node.span),
      node.span,
    );
  }
}

/** The `Shared<T>` entry a cell holding a `type` is created as. */
export function cellTypeIndex(context: FunctionContext, type: Type): TypeId {
  return context.tables.typeIndex(context.checker.sharedOf(type));
}
