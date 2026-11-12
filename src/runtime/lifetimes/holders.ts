/**
 * Which heap objects are held (spec §7): reachable from a root through what objects hold. A commit
 * persists only those (§5), and a live run, which never commits, lets go of the rest the same way.
 * Disposal never walks: counting decides when an object lost its last holder (counts.ts).
 *
 * - The roots are every live execution's frames (registers, and the cells references name), and
 *   every run's, the call a resolver readied, and every context constant's (snapshot/holdings.ts
 *   `keptFrame`), plus the futures an instance owes.
 * - An object holds what its kind's entry says (snapshot/holdings.ts) and what the heap's indexes
 *   add (`Heap.held`), and a frame what the one frame rule there says; a slot's queue and a
 *   weak reference hold nothing, so neither does a `disposed()` watch, which holds only its weak
 *   reference.
 * - The walk reads what each frame and object holds once, for both the objects it reaches and how
 *   deep the deepest value among them nests, which is what a commit checks against `maximumDepth`
 *   (spec §5): a commit walks the live state once.
 */

import { depthOf } from '../../definition/values/values.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import type { Heap, LiveObject } from '../scheduler/instance/heap.ts';
import {
  frameCells,
  frameValues,
  type Held as Holding,
  type HoldingFrame,
  idsHeld,
  isRoot,
  nothingHeld,
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

/** The objects of `heap` held from `roots`, and how deep what they hold nests, in one walk. */
export function heldFrom(heap: Heap, roots: Roots): Held {
  const objects = new Set<number>();
  const queue = [...roots.objects];
  let depth = 0;
  const reach = ({ values, holds }: Holding): void => {
    for (const contents of values) {
      depth = Math.max(depth, depthOf(contents));
    }
    pushAll(queue, idsHeld({ values, holds }));
  };
  for (const frame of roots.frames) {
    reach({ values: frameValues(frame), holds: frameCells(frame) });
  }
  for (const id of queue) {
    if (!objects.has(id) && heap.has(id)) {
      objects.add(id);
      reach(holdingOf(heap, heap.objectOf(id)));
    }
  }
  return { objects, depth };
}

/** What `object` holds (`Heap.holds`); a root is never held through. */
export function holdsOf(heap: Heap, object: LiveObject): readonly number[] {
  return idsHeld(holdingOf(heap, object));
}

/** What `object` holds, its values and the ids it holds directly (`Heap.held`); a root, nothing. */
function holdingOf(heap: Heap, object: LiveObject): Holding {
  return isRoot(object) ? nothingHeld : heap.held(object);
}
