/**
 * A heap for tests that build one from objects directly, as a snapshot would give them: it has made
 * each object it holds, and none after the last.
 */

import { countedIn } from '../../lifetimes/counts.ts';
import { HolderWrites } from '../../lifetimes/holder-writes.ts';
import { Heap, type LiveObject } from './heap.ts';

/** A heap holding `objects`, in id order, reporting its writes to `holders`. */
export function testHeap(
  objects: readonly LiveObject[] = [],
  holders: HolderWrites = new HolderWrites(countedIn([])),
): Heap {
  const heap = new Heap(Math.max(-1, ...objects.map(({ id }) => id)) + 1, holders);
  heap.restore(objects);
  return heap;
}
