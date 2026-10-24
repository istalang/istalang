/**
 * Places and parts of values (docs/arch/definition.md, "Places"): what an assignment writes, what
 * `&` passes, and how a destructured part is read.
 *
 * - A place is a variable's register plus field steps into its value. Tuple elements are fields
 *   by position, as `field` reads them. Writing a place with steps is a `store`, which builds the
 *   new value along its path (values are immutable); writing a bare register is a `move`.
 * - A register holding a cell or a reference is read and written through it by the runtime, so
 *   lowering emits the same instructions whatever the variable's storage is.
 */

import type { Place } from '../../definition/instructions/places.ts';
import type { Register } from '../../definition/operands.ts';
import type { Span } from '../../text/span.ts';
import { type Expression, type MemberAccess, placePath } from '../syntax/expressions.ts';
import type { Identifier } from '../syntax/node.ts';
import type { FunctionContext } from './context.ts';

/** The place `node` names: its variable's register, and the steps into the variable's value. */
export function placeOf(context: FunctionContext, node: Expression): Place {
  const { root, steps } = placePath(node);
  if (root.kind !== 'Identifier') {
    throw new Error(`A ${root.kind} is no place; the checker should have said so.`);
  }
  return {
    register: variableRegister(context, root),
    path: steps.map((step) => ({
      kind: 'field',
      index: step.kind === 'MemberAccess' ? fieldIndexOf(context, step) : step.element,
    })),
  };
}

/** The register the variable `node` names lives in. */
export function variableRegister(context: FunctionContext, node: Identifier): Register {
  const entity = context.entityOf(node);
  if (entity?.kind !== 'variable') {
    throw new Error(`'${node.text}' is not a variable; the checker should have said so.`);
  }
  return context.variables.registerOf(entity.name);
}

/** Writes `value` to `place`. */
export function writePlace(
  context: FunctionContext,
  place: Place,
  value: Register,
  span: Span,
): void {
  if (place.path.length === 0) {
    context.code.emit({ kind: 'move', span, dst: place.register, src: value });
  } else {
    context.code.emit({ kind: 'store', span, place, value });
  }
}

/** Reads the value at `place`: its variable's value, read along the place's field steps. */
export function readPlace(context: FunctionContext, place: Place, span: Span): Register {
  const positions = place.path.map((step) => {
    if (step.kind !== 'field') {
      throw new Error('Reading an element place arrives with indexing; the checker said so.');
    }
    return step.index;
  });
  return readPart(context, place.register, positions, span);
}

/** Reads the part of the value in `register` at `path`, field and element positions; its register. */
export function readPart(
  context: FunctionContext,
  register: Register,
  path: readonly number[],
  span: Span,
): Register {
  let current = register;
  for (const index of path) {
    const dst = context.code.allocate();
    context.code.emit({ kind: 'field', span, dst, src: current, index });
    current = dst;
  }
  return current;
}

/** The position, in its struct's declaration order, of the field `node` reads. */
export function fieldIndexOf(context: FunctionContext, node: MemberAccess): number {
  const type = context.body.typeOf(node.target);
  const index = (context.checker.fieldsOf(type) ?? []).findIndex(
    (field) => field.name === node.member.text,
  );
  if (index < 0) {
    throw new Error(`No field '${node.member.text}'; the checker should have said so.`);
  }
  return index;
}
