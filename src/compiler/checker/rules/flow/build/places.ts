/**
 * Places (§3.7, §3.9, §3.15): what `&` passes and an assignment writes, located once, in source
 * order.
 *
 * - A place is a variable or the value behind a handle (`*x`, `x->`), with fields, tuple elements
 *   and keyed fields read off it: a `Place` of parts.
 * - An indexed element is reached through its container's accessors instead: read with the
 *   container's `index` where the place is entered, the read part then the place's root, which a
 *   compound assignment reads and `&` passes. A change to it is made to it as it stands then: read
 *   anew, changed, and written back with `setIndex(&container, key, element)` (the implicit
 *   `write`), innermost first, so what changed another part meanwhile stays changed. An assignment
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
import { implicitCall, resolvedCall, valueAt } from './implicit-calls.ts';

/** Runs a change on a place as it stands now, given that place. */
type Changing = (change: (now: Place) => void) => void;

/**
 * A place entered: where it is, an element in it read where entered; and how it is changed as
 * its containers stand now, which a place with no element in it is, where it is.
 */
interface EnteredPlace {
  readonly place: Place;
  readonly changing: Changing | undefined;
}

/**
 * Enters the place `node` names, its root and keys computed now, to pass it by `&`; what writes
 * back what the call left in it once the call returns.
 */
export function enterPlace(
  builder: FlowBuilder,
  node: Expression,
): { readonly place: Place; readonly leave: () => void } {
  const entered = enteredAt(builder, node);
  const { place, changing } = entered;
  const leave = () => {
    if (changing !== undefined) {
      const value = valueAt(builder, place);
      changing((now) => builder.emit({ op: 'write', site: place.site, place: now, value }));
    }
  };
  return { place, leave };
}

/** The place `node` names, entered. */
function enteredAt(builder: FlowBuilder, node: Expression): EnteredPlace {
  const { root, steps } = placePath(node);
  let entered: EnteredPlace = { place: rootPlace(builder, root), changing: undefined };
  for (const step of steps) {
    entered = stepInto(builder, entered, step);
  }
  return { ...entered, place: { ...entered.place, site: node } };
}

/**
 * `entered` stepped into by `step`, the place it then names: a part of it, or an element its
 * container's `index` reads, changed by reading it anew and writing it back.
 */
function stepInto(builder: FlowBuilder, entered: EnteredPlace, step: PlaceStep): EnteredPlace {
  const { place, changing } = entered;
  if (step.kind !== 'Index' || builder.body.fieldReadOf(step) !== undefined) {
    const part = partAt(builder, step);
    return {
      place: within(place, part, step),
      changing: changing && ((change) => changing((now) => change(within(now, part, step)))),
    };
  }
  const index = step;
  const key = builder.expression(index.index);
  const element = (container: Place) => ({
    root: indexed(builder, index, container, key),
    path: [],
    site: index,
    name: undefined,
  });
  return {
    place: element(place),
    changing: (change) =>
      changed(entered, (now) => {
        const fresh = element(now);
        change(fresh);
        writeElement(builder, index, { container: now, key, element: fresh.root });
      }),
  };
}

/** The part `step` reaches: a field, a tuple element or a keyed field, its key computed now. */
function partAt(builder: FlowBuilder, step: PlaceStep): Part {
  if (step.kind === 'TupleElement') {
    return { kind: 'step', step: step.element };
  }
  const read = builder.body.fieldReadOf(step);
  if (step.kind === 'MemberAccess') {
    // A member checking found no field for names the field all the same.
    const of = builder.body.typeOf(step.target) ?? errorType;
    const named: Part = { kind: 'step', step: { kind: 'field', of, name: step.member.text } };
    return read === undefined ? named : partOfField(read);
  }
  return read === undefined
    ? unreachable('An element is no part of its container.')
    : partOfField(read, builder.expression(step.index));
}

/** Runs `change` on `entered` as it stands now: through its containers, or where it is. */
function changed({ place, changing }: EnteredPlace, change: (now: Place) => void): void {
  if (changing === undefined) {
    change(place);
  } else {
    changing(change);
  }
}

/** The element of `container` at `key`, read now with the `index` checking resolved at `node`. */
function indexed(builder: FlowBuilder, node: Index, container: Place, key: ValueId): ValueId {
  return resolvedCall(builder, builder.body.resolved.get(node), {
    site: node,
    passed: [valueAt(builder, container), key],
    into: builder.temporaryOf(node),
  });
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
    const container = enteredAt(builder, last.target);
    const key = builder.expression(last.index);
    return {
      read: () => indexed(builder, last, container.place, key),
      write: (element) =>
        changed(container, (now) => writeElement(builder, last, { container: now, key, element })),
    };
  }
  const entered = enteredAt(builder, target);
  const { place } = entered;
  return {
    read: () => valueAt(builder, place),
    write: (value) => {
      const root = builder.valueOf(place.root);
      if (entered.changing === undefined && place.path.length === 0 && root.kind === 'variable') {
        const site = place.name ?? target;
        builder.emit({ op: 'copy', site, into: place.root, from: value, fit: undefined });
      } else {
        changed(entered, (now) => builder.emit({ op: 'write', site: target, place: now, value }));
      }
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
      return { kind: 'required', on: read.on, required: read.required };
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
