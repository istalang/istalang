/**
 * Places and parts of values (docs/arch/definition.md, "Places"): what an assignment writes, what
 * `&` passes, and how a destructured part is read.
 *
 * - A place is a variable's register plus steps into its value: fields, where tuple elements are
 *   fields by position as `field` reads them, and indexed elements, each with its key's register
 *   and the `index` and `setIndex` the checker resolved for it. Writing a place with steps is a
 *   `store`, which builds the new value along its path (values are immutable), calling `setIndex`
 *   for an element; writing a bare register is a `move`. Each key is computed once, when the
 *   place is, so reading and writing it back see the same element.
 * - A register holding a cell or a reference is read and written through it by the runtime, so
 *   lowering emits the same instructions whatever the variable's storage is.
 */

import type { Place } from '../../definition/instructions/places.ts';
import type { Register } from '../../definition/operands.ts';
import type { Span } from '../../text/span.ts';
import { type Expression, type MemberAccess, placePath } from '../syntax/expressions.ts';
import type { Identifier } from '../syntax/node.ts';
import type { FunctionContext } from './context.ts';
import { emitCall } from './emit-call.ts';

/** One step of a place in code. */
type PathStep = Place['path'][number];

/** The place `node` names: its variable's register, and the steps into the variable's value. */
export function placeOf(context: FunctionContext, node: Expression): Place {
  const { root, steps } = placePath(node);
  if (root.kind !== 'Identifier') {
    throw new Error(`A ${root.kind} is no place; the checker should have said so.`);
  }
  return { register: variableRegister(context, root), path: pathOf(context, steps) };
}

/**
 * A place's steps: a struct field by its position, a tuple element, or an element by its key and
 * the functions reading and writing it.
 */
export function pathOf(
  context: FunctionContext,
  steps: ReturnType<typeof placePath>['steps'],
): Place['path'] {
  return steps.map((step): PathStep => {
    switch (step.kind) {
      case 'MemberAccess':
        return { kind: 'field', index: fieldIndexOf(context, step) };
      case 'TupleElement':
        return { kind: 'field', index: step.element };
      case 'Index':
        return {
          kind: 'element',
          key: context.expression(step.index),
          read: context.calleeIndex(step),
          write: context.implicitCallee(step, 'write'),
        };
      default: {
        const unhandled: never = step;
        return unhandled;
      }
    }
  });
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

/** Reads the value at `place`: its variable's value, read along the place's steps. */
export function readPlace(context: FunctionContext, place: Place, span: Span): Register {
  let current = place.register;
  for (const step of place.path) {
    const dst = context.code.allocate();
    if (step.kind === 'field') {
      context.code.emit({ kind: 'field', span, dst, src: current, index: step.index });
    } else {
      emitCall(context, { span, callee: step.read, arguments: [current, step.key] }, dst);
    }
    current = dst;
  }
  return current;
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
export function fieldIndexOf(
  context: FunctionContext,
  node: MemberAccess,
  link: Expression = node,
): number {
  const type = context.body.chainOf(link)?.base ?? context.body.typeOf(node.target);
  const index = (context.checker.fieldsOf(type) ?? []).findIndex(
    (field) => field.name === node.member.text,
  );
  if (index < 0) {
    throw new Error(`No field '${node.member.text}'; the checker should have said so.`);
  }
  return index;
}
