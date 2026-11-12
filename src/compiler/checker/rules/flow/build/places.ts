/**
 * Places (§3.7, §3.9, §3.15): what `&` passes and an assignment writes, located once, in source
 * order, as lowering locates them (lowering/constructs/parts/places.ts).
 *
 * - A place is a variable or the value behind a handle (`*x`, `x->`), with fields, tuple elements
 *   and keyed fields read off it: a `Place` of parts.
 * - An indexed element is reached through its container's accessors instead: read with the
 *   container's `index`, the read part then the place's root; once done with, written back with
 *   `setIndex(&container, key, element)` (the implicit `write`), innermost first. An assignment
 *   ending at an element writes it with `setIndex` alone, never reading it.
 */

import type { Expression, Index } from '../../../../syntax/expressions/index.ts';
import { type PlaceStep, placePath } from '../../../../syntax/expressions/places.ts';
import type { FieldRead } from '../../../surface/checked-field.ts';
import type { Argument, Part, Place, ValueId } from '../flow-ir.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';

/** A place entered: where it is, and how what an accessor read is written back once done with. */
export interface EnteredPlace {
  readonly place: Place;
  readonly leave: () => void;
}

/** Enters the place `node` names, its root and keys computed now. */
export function enterPlace(builder: FlowBuilder, node: Expression): EnteredPlace {
  const { root, steps } = placePath(node);
  let place = rootPlace(builder, root, node);
  const leaves: (() => void)[] = [];
  for (const step of steps) {
    const { place: next, leave } = stepInto(builder, place, step, node);
    place = next;
    leaves.push(leave);
  }
  return { place: { ...place, site: node }, leave: () => leaveAll(leaves) };
}

/**
 * `place` stepped into by `step`, in the place `node` names: a part of it, or an element its
 * container's `index` reads, written back once done with.
 */
function stepInto(
  builder: FlowBuilder,
  place: Place,
  step: PlaceStep,
  node: Expression,
): EnteredPlace {
  const stays = () => undefined;
  if (step.kind === 'TupleElement') {
    return { place: within(place, { kind: 'step', step: step.element }), leave: stays };
  }
  const key = step.kind === 'Index' ? builder.expression(step.index) : undefined;
  const read = builder.body.fieldReadOf(step);
  if (key === undefined || read !== undefined) {
    const part: Part = read === undefined ? { kind: 'keyed' } : partOfField(read);
    return { place: within(place, part), leave: stays };
  }
  const element = builder.temporaryOf(step);
  resolvedCall(builder, builder.body.resolved.get(step), {
    site: step,
    passed: [builder.valueAt(place), key],
    into: element,
  });
  return {
    place: { root: element, path: [], site: node, name: undefined },
    leave: () => writeElement(builder, step as Index, { container: place, key, element }),
  };
}

/**
 * Writes `value` into the place `target` names: a variable assigned whole, a part of a place, or
 * an element its container's `setIndex` writes.
 */
export function assign(builder: FlowBuilder, target: Expression, value: ValueId): void {
  const { steps } = placePath(target);
  const last = steps.at(-1);
  if (last?.kind === 'Index' && builder.body.fieldReadOf(last) === undefined) {
    const container = enterPlace(builder, last.target);
    const key = builder.expression(last.index);
    writeElement(builder, last, { container: container.place, key, element: value });
    container.leave();
    return;
  }
  const { place, leave } = enterPlace(builder, target);
  const root = builder.valueOf(place.root);
  if (place.path.length === 0 && root.kind === 'variable') {
    builder.emit({
      op: 'copy',
      site: place.name ?? target,
      into: place.root,
      from: value,
      fit: undefined,
    });
  } else {
    builder.emit({ op: 'write', site: target, place, value });
  }
  leave();
}

/** The place `root` names: a variable (or a global), what is behind a handle, or a value. */
function rootPlace(builder: FlowBuilder, root: Expression, node: Expression): Place {
  if (root.kind === 'Identifier') {
    const entity = builder.entityOf(root);
    if (entity !== undefined && builder.body.declaredTypeOf(entity.name) !== undefined) {
      return { root: builder.variable(entity), path: [], site: node, name: root };
    }
  }
  if (root.kind === 'Dereference') {
    const handle = builder.expression(root.operand);
    return { root: handle, path: [{ kind: 'behind' }], site: node, name: undefined };
  }
  return { root: builder.expression(root), path: [], site: node, name: undefined };
}

function within(place: Place, part: Part): Place {
  return { ...place, path: [...place.path, part] };
}

/** The part a field read reaches: a field by name or position, or one a key names. */
export function partOfField(read: FieldRead): Part {
  switch (read.kind) {
    case 'position':
      return { kind: 'step', step: read.index };
    case 'named':
      return { kind: 'step', step: { kind: 'field', of: read.on, name: read.name } };
    case 'required':
    case 'dispatch':
      return {
        kind: 'step',
        step: { kind: 'field', of: read.on, name: read.required.field.name.text },
      };
    case 'keyed':
      return { kind: 'keyed' };
    default: {
      const unhandled: never = read;
      return unhandled;
    }
  }
}

/** An element of a container, by its key. */
interface Element {
  readonly container: Place;
  readonly key: ValueId;
  readonly element: ValueId;
}

/** `setIndex(&container, key, element)`: the element written back into its container. */
function writeElement(builder: FlowBuilder, index: Index, { container, key, element }: Element) {
  const place: Argument = { kind: 'place', place: container };
  implicitCall(builder, 'write', { site: index, passed: [place, key, element] });
}

/** Writes back what accessors read for places, the last entered first. */
export function leaveAll(leaves: readonly (() => void)[]): void {
  for (const leave of leaves.toReversed()) {
    leave();
  }
}
