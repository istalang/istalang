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

import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import type { Expression, Index } from '../../../../syntax/expressions/index.ts';
import { type PlaceStep, placePath } from '../../../../syntax/expressions/places.ts';
import type { Identifier } from '../../../../syntax/tree/node.ts';
import type { FieldRead } from '../../../surface/checked-field.ts';
import type { Argument, Part, Place, ValueId } from '../../../surface/flow-ir.ts';
import { errorType } from '../../../types/type/primitives.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';

/** A place entered: where it is, and how what an accessor read is written back once done with. */
interface EnteredPlace {
  readonly place: Place;
  readonly leave: () => void;
}

/** Enters the place `node` names, its root and keys computed now. */
export function enterPlace(builder: FlowBuilder, node: Expression): EnteredPlace {
  const { root, steps } = placePath(node);
  let place = rootPlace(builder, root);
  const leaves: (() => void)[] = [];
  for (const step of steps) {
    const { place: next, leave } = stepInto(builder, place, step);
    place = next;
    leaves.push(leave);
  }
  return { place: { ...place, site: node }, leave: () => leaveAll(leaves) };
}

/**
 * `place` stepped into by `step`, the place it then names: a part of it, or an element its
 * container's `index` reads, written back once done with.
 */
function stepInto(builder: FlowBuilder, place: Place, step: PlaceStep): EnteredPlace {
  const stays = () => undefined;
  if (step.kind === 'TupleElement') {
    return { place: within(place, { kind: 'step', step: step.element }, step), leave: stays };
  }
  const read = builder.body.fieldReadOf(step);
  if (step.kind === 'MemberAccess') {
    // A member checking found no field for names the field all the same.
    const of = builder.body.typeOf(step.target) ?? errorType;
    const named: Part = { kind: 'step', step: { kind: 'field', of, name: step.member.text } };
    const part = read === undefined ? named : partOfField(read);
    return { place: within(place, part, step), leave: stays };
  }
  const key = builder.expression(step.index);
  if (read !== undefined) {
    return { place: within(place, partOfField(read, key), step), leave: stays };
  }
  const element = builder.temporaryOf(step);
  resolvedCall(builder, builder.body.resolved.get(step), {
    site: step,
    passed: [builder.valueAt(place), key],
    into: element,
  });
  return {
    place: { root: element, path: [], site: step, name: undefined },
    leave: () => writeElement(builder, step, { container: place, key, element }),
  };
}

/** The place an assignment writes, entered: what it holds now, and writing it, which leaves it. */
interface AssignedPlace {
  readonly read: () => ValueId;
  readonly write: (value: ValueId) => void;
}

/**
 * Enters the place `target` names for an assignment: a variable assigned whole, a part of a place,
 * or an element its container's `setIndex` writes, never read unless asked to (a map may not hold
 * its key yet).
 */
export function enterAssigned(builder: FlowBuilder, target: Expression): AssignedPlace {
  const last = placePath(target).steps.at(-1);
  if (last?.kind === 'Index' && builder.body.fieldReadOf(last) === undefined) {
    const container = enterPlace(builder, last.target);
    const key = builder.expression(last.index);
    return {
      read: () =>
        resolvedCall(builder, builder.body.resolved.get(last), {
          site: last,
          passed: [builder.valueAt(container.place), key],
          into: builder.temporaryOf(last),
        }),
      write: (element) => {
        writeElement(builder, last, { container: container.place, key, element });
        container.leave();
      },
    };
  }
  const { place, leave } = enterPlace(builder, target);
  return {
    read: () => builder.valueAt(place),
    write: (value) => {
      const root = builder.valueOf(place.root);
      if (place.path.length === 0 && root.kind === 'variable') {
        const site = place.name ?? target;
        builder.emit({ op: 'copy', site, into: place.root, from: value, fit: undefined });
      } else {
        builder.emit({ op: 'write', site: target, place, value });
      }
      leave();
    },
  };
}

/** The place `root` names: a variable (or a global), what is behind a handle, or a value. */
function rootPlace(builder: FlowBuilder, root: Expression): Place {
  const entity = root.kind === 'Identifier' ? builder.entityOf(root) : undefined;
  if (entity !== undefined) {
    const named = builder.named(entity, builder.body.typeOf(root));
    return { root: named, path: [], site: root, name: root as Identifier };
  }
  if (root.kind === 'Dereference') {
    const handle = builder.expression(root.operand);
    return { root: handle, path: [{ kind: 'behind' }], site: root, name: undefined };
  }
  return { root: builder.expression(root), path: [], site: root, name: undefined };
}

/** `place` stepped into its `part`, the place `site` names. */
function within(place: Place, part: Part, site: Expression): Place {
  return { ...place, path: [...place.path, part], site };
}

/**
 * The part a field read reaches: a field by name or position, or the one `key`, a key of several
 * names an index reads with, names.
 */
export function partOfField(read: FieldRead, key?: ValueId): Part {
  switch (read.kind) {
    case 'position':
      return { kind: 'step', step: { kind: 'field', of: read.on, name: read.name } };
    case 'named':
      return { kind: 'step', step: { kind: 'field', of: read.on, name: read.name } };
    case 'required':
    case 'dispatch':
      return {
        kind: 'step',
        step: { kind: 'field', of: read.on, name: read.required.field.name.text },
      };
    case 'keyed':
      return key === undefined
        ? unreachable('A key of several names is read only by an index.')
        : { kind: 'keyed', key };
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
