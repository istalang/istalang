/**
 * Holding (§7) against its definition: exactly what the roots reach through holds is held, over
 * random heaps with cycles; watching (a weak reference, a slot's queue, `disposed()`) holds
 * nothing; the walk's depth is the deepest held value's; and a chain far longer than the host's
 * stack is walked.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { depthOf, handlesIn, handleTo } from '../../definition/values/values.ts';
import { testHeap } from '../scheduler/instance/heap.test-kit.ts';
import type { LiveObject } from '../scheduler/instance/heap.ts';
import { frameValues, isRoot, valuesIn } from '../snapshot/holdings.ts';
import { heldFrom, holdsOf } from './holders.ts';
import { heapArbitrary, reachedFrom } from './lifetimes.test-kit.ts';

describe('holding', () => {
  it('holds exactly what the roots reach', () => {
    fc.assert(
      fc.property(
        heapArbitrary(),
        fc.array(fc.nat({ max: 7 }), { maxLength: 2 }),
        (test, objects) => {
          const { heap, frames } = test;
          const start = [...objects, ...frames.flatMap(frameValues).flatMap(handlesIn)];
          const expected = reachedFrom(start, (id) => holdsOf(heap, heap.objectOf(id)));
          expect(heldFrom(heap, { frames, objects }).objects).toEqual(expected);
        },
      ),
    );
  });

  it('finds the depth of the deepest value held', () => {
    fc.assert(
      fc.property(heapArbitrary(), ({ heap, frames }) => {
        const held = heldFrom(heap, { frames, objects: [] });
        const values = [
          ...frames.flatMap(frameValues),
          ...[...held.objects].flatMap((id) => {
            const object = heap.objectOf(id);
            return isRoot(object) ? [] : valuesIn(object);
          }),
        ];
        expect(held.depth).toBe(Math.max(0, ...values.map(depthOf)));
      }),
    );
  });

  it.each<[string, LiveObject]>([
    ['a weak reference', { kind: 'weakRef', id: 0, target: 1 }],
    ['a slot waited on', { kind: 'slot', id: 0, waiting: [1] }],
  ])('holds nothing through %s', (_case, watcher) => {
    const heap = testHeap([watcher, { kind: 'cell', id: 1, type: 0, value: null }]);
    expect([...heldFrom(heap, { frames: [], objects: [0] }).objects]).toEqual([0]);
  });

  it('holds the weak reference a disposed() watch is on, and never its referent', () => {
    const heap = testHeap([
      { kind: 'future', id: 0, state: { kind: 'disposed', weakRef: 2 } },
      { kind: 'cell', id: 1, type: 0, value: null },
      { kind: 'weakRef', id: 2, target: 1 },
    ]);
    expect(new Set(heldFrom(heap, { frames: [], objects: [0] }).objects)).toEqual(new Set([0, 2]));
  });

  it('walks a chain far longer than the host stack is deep', () => {
    const length = 100_000;
    const cells = Array.from(
      { length },
      (_, id): LiveObject => ({
        kind: 'cell',
        id,
        type: 1,
        value: id + 1 < length ? handleTo(id + 1) : null,
      }),
    );
    const held = heldFrom(testHeap(cells), {
      frames: [{ registers: [handleTo(0)] }],
      objects: [],
    });
    expect(held.objects.size).toBe(length);
  });
});
