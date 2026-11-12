/**
 * Which heap objects are held (spec §7): reachable from a root through what objects hold. A commit
 * persists only those (§5), and a live run, which never commits, lets go of the rest the same way.
 * Disposal never walks: counting decides when an object lost its last holder (counts.ts).
 *
 * - The roots are every live execution's frames (registers, and the cells references name) and the
 *   other root objects (snapshot/holdings.ts `rootKinds`): a run holds what it calls with, a context
 *   constant its value, an answer and an awaited outcome their futures.
 * - Every object holds what its kind's entry says (snapshot/holdings.ts) and what the heap's indexes
 *   add (`Heap.held`), as its writes report for counting, and a frame what the one frame rule there
 *   says; a slot's queue and a weak reference hold nothing, so neither does a `disposed()` watch,
 *   which holds only its weak reference. An execution's frames hold for it: their registers report
 *   their own writes.
 * - The walk reads what each frame and object holds once, for both the objects it reaches and how
 *   deep the deepest value among them nests, which is what a commit checks against `maximumDepth`
 *   (spec §5): a commit walks the live state once.
 */

import { depthOf } from '../../definition/values/values.ts';
import { pushAll } from '../../foundation/structures/stack.ts';
import type { Heap } from '../scheduler/instance/heap.ts';
import {
  frameCells,
  frameValues,
  type Held as Holding,
  type HoldingFrame,
  idsHeld,
} from '../snapshot/holdings.ts';

/** Where holding starts: the executions' frames, and the other root objects. */
export interface Roots {
  readonly frames: Iterable<HoldingFrame>;
  readonly objects: Iterable<number>;
}

/** What a walk from the roots found. */
export interface Held {
  /** Every object reached, the roots given as objects among them; executions aside. */
  readonly objects: ReadonlySet<number>;
  /** How deep the deepest value the roots and held objects hold nests. */
  readonly depth: number;
}

/** The objects of `heap` held from `roots`, and how deep what they hold nests, in one walk. */
export function heldFrom(heap: Heap, roots: Roots): Held {
  const objects = new Set<number>();
  const queue = [...roots.objects];
  let depth = 0;
  const reach = (holding: Holding): void => {
    for (const contents of holding.values) {
      depth = Math.max(depth, depthOf(contents));
    }
    pushAll(queue, idsHeld(holding));
  };
  for (const frame of roots.frames) {
    reach({ values: frameValues(frame), holds: frameCells(frame) });
  }
  for (const id of queue) {
    if (!objects.has(id) && heap.has(id)) {
      objects.add(id);
      reach(heap.held(heap.objectOf(id)));
    }
  }
  return { objects, depth };
}
