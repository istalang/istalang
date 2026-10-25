/**
 * Random heaps for the properties of holding and disposal: objects of every kind that holds or
 * watches others, their values holding handles to any of them, cycles included, and frames whose
 * registers and kept lists hold some of them. Ids are 0 to `size - 1`, and only type entry 0 is
 * disposable by a declared `dispose`, so a cell is disposable or not by its type.
 */

import fc from 'fast-check';
import type { TypeDefinition } from '../../definition/types.ts';
import { valueArbitrary } from '../../definition/values.test-kit.ts';
import type { Value } from '../../definition/values.ts';
import { Heap, type LiveObject } from '../scheduler/heap.ts';
import type { HoldingFrame } from './holders.ts';

/** Type entry 0 disposes by function 0; type entry 1 disposes nothing. */
export const testTypes: readonly TypeDefinition[] = [
  {
    kind: 'extern',
    name: 'test.Lease',
    arguments: [],
    sendable: false,
    disposal: { kind: 'function', function: 0 },
  },
  {
    kind: 'extern',
    name: 'test.Plain',
    arguments: [],
    sendable: false,
    disposal: { kind: 'none' },
  },
];

/** A heap of `size` objects, and the frames holding some of them. */
export interface TestHeap {
  readonly heap: Heap;
  readonly frames: readonly HoldingFrame[];
}

export function heapArbitrary(size = 8): fc.Arbitrary<TestHeap> {
  const ids = Array.from({ length: size }, (_, position) => position);
  const id = fc.constantFrom(...ids);
  const contents = valueArbitrary({ handles: ids });
  const objectAt = (object: number): fc.Arbitrary<LiveObject> =>
    fc.oneof(
      fc
        .record({ type: fc.constantFrom(0, 1), value: contents })
        .map(({ type, value }): LiveObject => ({ kind: 'cell', id: object, type, value })),
      fc.record({ value: fc.option(contents, { nil: undefined }), waiting: fc.array(id) }).map(
        ({ value, waiting }): LiveObject => ({
          kind: 'slot',
          id: object,
          waiting,
          ...(value === undefined ? {} : { value }),
        }),
      ),
      contents.map(
        (value): LiveObject => ({
          kind: 'future',
          id: object,
          state: { kind: 'resolved', value },
        }),
      ),
      fc.record({ slot: id, value: contents }).map(
        ({ slot, value }): LiveObject => ({
          kind: 'future',
          id: object,
          state: { kind: 'slot', slot, operation: 'put', value },
        }),
      ),
      fc.array(id, { minLength: 1, maxLength: 3 }).map(
        (futures): LiveObject => ({
          kind: 'future',
          id: object,
          state: { kind: 'first', futures },
        }),
      ),
      id.map(
        (weakRef): LiveObject => ({
          kind: 'future',
          id: object,
          state: { kind: 'disposed', weakRef },
        }),
      ),
      contents.map((callback): LiveObject => ({ kind: 'guard', id: object, callback })),
      fc.option(id, { nil: undefined }).map(
        (target): LiveObject => ({
          kind: 'weakRef',
          id: object,
          ...(target === undefined ? {} : { target }),
        }),
      ),
    );
  const frame = fc
    .record({
      registers: fc.array(fc.option(contents, { nil: undefined }), { maxLength: 4 }),
      kept: fc.array(contents, { maxLength: 2 }),
    })
    .map(({ registers, kept }): HoldingFrame => ({ registers, kept: [...kept] }));
  return fc
    .record({
      objects: fc.tuple(...ids.map(objectAt)),
      frames: fc.array(frame, { maxLength: 3 }),
    })
    .map(({ objects, frames }) => ({ heap: new Heap(objects), frames }));
}

/** Every object `start` reaches through `edges`, each found by the naive recursion. */
export function reachedFrom(
  start: readonly number[],
  edges: (id: number) => readonly number[],
): ReadonlySet<number> {
  const reached = new Set<number>();
  const visit = (id: number): void => {
    if (!reached.has(id)) {
      reached.add(id);
      edges(id).forEach(visit);
    }
  };
  start.forEach(visit);
  return reached;
}

/** The values `frame` holds. */
export function frameValues(frame: HoldingFrame): readonly Value[] {
  return [
    ...frame.registers.filter((contents): contents is Value => contents !== undefined),
    ...frame.kept,
  ];
}
