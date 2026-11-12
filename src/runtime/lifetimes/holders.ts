/**
 * Which heap objects are held (spec §7): reachable from a root through what objects hold. A commit
 * persists only those (§5), and a live run, which never commits, lets go of the rest the same way.
 * Disposal never walks: counting decides when an object lost its last holder (counts.ts).
 *
 * - The roots are every live execution's frames (registers, and the cells references name), and
 *   every run's, the call a resolver readied, and every context constant's (snapshot/holdings.ts
 *   `keptFrame`), plus the futures an instance owes.
 * - An object holds what its kind's entry says (snapshot/holdings.ts) and what the heap's indexes
 *   add (`Heap.holds`), and a frame what the one frame rule there says; a slot's queue and a
 *   weak reference hold nothing, so neither does a `disposed()` watch, which holds only its weak
 *   reference.
 * - The one walk also finds how deep the deepest held value nests, which is what a commit checks
 *   against `maximumDepth` (spec §5), so a commit walks the live state once.
 */

import { depthOf, handlesIn, type Value } from '../../definition/values/values.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import type { Heap, LiveObject } from '../scheduler/instance/heap.ts';
import {
  frameCells,
  frameValues,
  type HoldingFrame,
  isRoot,
  valuesIn,
} from '../snapshot/holdings.ts';

/** Where holding starts: frames, and objects held for the scheduler's own reasons. */
export interface Roots {
  readonly frames: Iterable<HoldingFrame>;
  readonly objects: Iterable<number>;
}

/** What a walk from the roots found. */
export interface Held {
  /** Every object held, executions aside: an execution is a root while it lives. */
  readonly objects: ReadonlySet<number>;
  /** How deep the deepest value the roots and held objects hold nests. */
  readonly depth: number;
}

/** The objects of `heap` held from `roots`, and how deep what they hold nests. */
export function heldFrom(heap: Heap, roots: Roots): Held {
  const frames = [...roots.frames];
  const objects = reached(heap, frames, roots.objects);
  const values = [
    ...frames.flatMap(frameValues),
    ...[...objects].flatMap((id) => valuesOf(heap, id)),
  ];
  return { objects, depth: deepestOf(values) };
}

/** What `object` holds (`Heap.holds`); a root is never held through. */
export function holdsOf(heap: Heap, object: LiveObject): readonly number[] {
  return isRoot(object) ? [] : heap.holds(object);
}

/** The objects reached from `frames` and `objects` through what objects hold. */
function reached(
  heap: Heap,
  frames: readonly HoldingFrame[],
  objects: Iterable<number>,
): Set<number> {
  const found = new Set<number>();
  const queue = [...objects];
  for (const frame of frames) {
    pushAll(queue, frameCells(frame));
    pushAll(queue, frameValues(frame).flatMap(handlesIn));
  }
  for (const id of queue) {
    if (!found.has(id) && heap.has(id)) {
      found.add(id);
      pushAll(queue, holdsOf(heap, heap.objectOf(id)));
    }
  }
  return found;
}

function valuesOf(heap: Heap, id: number): readonly Value[] {
  const object = heap.objectOf(id);
  return isRoot(object) ? [] : valuesIn(object);
}

function deepestOf(values: readonly Value[]): number {
  return values.reduce<number>((deepest, contents) => Math.max(deepest, depthOf(contents)), 0);
}
