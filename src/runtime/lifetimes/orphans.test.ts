/**
 * Which unheld disposables are ready (§7), against the definition over random heaps: exactly the
 * disposable orphans no other disposable orphan reaches from outside their cycle, newest first.
 * Orphans holding each other in a cycle are ready together; one held by another disposable orphan,
 * even through a plain cell, waits for that one's disposal.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { handleTo } from '../../definition/values/values.ts';
import { Heap, type LiveObject } from '../scheduler/instance/heap.ts';
import { isDisposable } from './disposal.ts';
import { heldFrom, holdsOf } from './holders.ts';
import { heapArbitrary, reachedFrom, testTypes } from './lifetimes.test-kit.ts';
import { readyOrphans } from './orphans.ts';

/** Whether `object` of `heap` is disposed when nothing holds it. */
const disposableIn = (heap: Heap) => (object: LiveObject) =>
  isDisposable({ heap, types: testTypes }, object);

describe('ready orphans', () => {
  it('are the disposable orphans no other disposable orphan reaches from outside their cycle', () => {
    fc.assert(
      fc.property(heapArbitrary(), ({ heap, frames }) => {
        const held = heldFrom(heap, { frames, objects: [] }).objects;
        const orphans = heap.objects().filter((object) => !held.has(object.id));
        const isOrphan = new Set(orphans.map(({ id }) => id));
        const edges = (id: number) => holdsOf(heap.objectOf(id)).filter((to) => isOrphan.has(to));
        const reaches = (source: number, target: number) =>
          edges(source).some((next) => reachedFrom([next], edges).has(target));
        const disposable = disposableIn(heap);
        const candidates = orphans.filter(disposable).map(({ id }) => id);
        const expected = candidates.filter(
          (id) =>
            !candidates.some((other) => other !== id && reaches(other, id) && !reaches(id, other)),
        );
        const from = heap.objects().map(({ id }) => id);
        expect(readyOrphans(heap, { held, from, isDisposable: disposable })).toEqual(
          expected.toSorted((first, second) => second - first),
        );
      }),
    );
  });

  it('dispose a cycle together, and a lease held through a plain cell after its holder', () => {
    const lease = (id: number, holds?: number): LiveObject => ({
      kind: 'cell',
      id,
      type: 0,
      value: holds === undefined ? null : handleTo(holds),
    });
    const plain: LiveObject = { kind: 'cell', id: 4, type: 1, value: handleTo(5) };
    const heap = new Heap([lease(0, 1), lease(1, 0), lease(2, 4), lease(3), plain, lease(5)]);
    const frames = [{ registers: [handleTo(3)] }];
    const held = heldFrom(heap, { frames, objects: [] }).objects;
    const from = [0, 2];
    expect(readyOrphans(heap, { held, from, isDisposable: disposableIn(heap) })).toEqual([2, 1, 0]);
  });
});
