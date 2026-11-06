/**
 * A slot's rules (spec §6) over random sequences of operations on one slot: every value is taken
 * exactly once, in the order it was put, by takes served in the order they came; an operation
 * that can complete at once does; and a full slot never keeps a take or read waiting, nor an empty
 * one a put.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Value } from '../../../definition/values/values.ts';
import { ignoredEvents } from './futures.test-kit.ts';
import { Futures } from './futures.ts';
import { Heap, handleObject } from './heap.ts';
import { type SlotOperation, Slots } from './slots.ts';

/** One slot and what each operation on it returned, in the order they were made. */
function operateAll(sequence: readonly SlotOperation[]) {
  const heap = new Heap([]);
  const futures = new Futures(heap, ignoredEvents);
  const slots = new Slots(heap, futures);
  const slot = slots.create();
  const made = sequence.map((operation, position) => {
    const wasFull = heap.of(handleObject(slot), 'slot').value !== undefined;
    const value: Value = operation === 'put' ? BigInt(position) : null;
    const future = slots.operate(slot, operation, value);
    return {
      operation,
      value,
      future,
      canComplete: (operation === 'put') !== wasFull,
      completed: futures.settled(future) !== undefined,
    };
  });
  const settled = (future: Value) => futures.settled(future);
  return { made, settled, slot: heap.of(handleObject(slot), 'slot'), heap };
}

const operations = fc.array(fc.constantFrom<SlotOperation>('put', 'take', 'read'), {
  maxLength: 40,
});

describe('a slot', () => {
  it('completes at once an operation that can complete when it is made', () => {
    fc.assert(
      fc.property(operations, (sequence) => {
        const { made } = operateAll(sequence);
        expect(made.filter((each) => each.canComplete && !each.completed)).toEqual([]);
      }),
    );
  });

  it('gives each put value to one take, in put order, serving takes in the order they came', () => {
    fc.assert(
      fc.property(operations, (sequence) => {
        const { made, settled } = operateAll(sequence);
        const takes = made.filter(({ operation }) => operation === 'take');
        const taken = takes.map(({ future }) => settled(future));
        const served = taken.filter((each) => each !== undefined).length;
        expect(taken.slice(0, served).every((each) => each !== undefined)).toBe(true);
        expect(taken.slice(served).every((each) => each === undefined)).toBe(true);
        const putValues = made
          .filter(({ operation }) => operation === 'put')
          .map(({ value }) => value);
        expect(taken.slice(0, served).map((each) => each?.value)).toEqual(
          putValues.slice(0, served),
        );
      }),
    );
  });

  it('fills in put order, and holds a value exactly when more puts completed than takes', () => {
    fc.assert(
      fc.property(operations, (sequence) => {
        const { made, settled, slot } = operateAll(sequence);
        const completed = (operation: SlotOperation) =>
          made
            .filter((each) => each.operation === operation)
            .map(({ future }) => settled(future) !== undefined);
        const puts = completed('put');
        const done = puts.filter(Boolean).length;
        expect(puts.slice(0, done).every(Boolean)).toBe(true);
        const takes = completed('take').filter(Boolean).length;
        expect(slot.value !== undefined).toBe(done === takes + 1);
        expect(done - takes).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('keeps no take or read waiting while full, and no put while empty', () => {
    fc.assert(
      fc.property(operations, (sequence) => {
        const { slot, heap } = operateAll(sequence);
        const waiting = slot.waiting.map((id) => heap.of(id, 'future').state);
        const kinds = waiting.map((state) => (state.kind === 'slot' ? state.operation : 'none'));
        const allowed = slot.value === undefined ? ['take', 'read'] : ['put'];
        expect(kinds.every((kind) => allowed.includes(kind))).toBe(true);
      }),
    );
  });

  it('gives the value that arrives to every read before the first waiting take, which empties it', () => {
    const { made, settled, slot } = operateAll(['read', 'read', 'take', 'read', 'put']);
    expect(made.map(({ future }) => settled(future)?.value)).toEqual([4n, 4n, 4n, undefined, null]);
    expect(slot.value).toBeUndefined();
  });
});
