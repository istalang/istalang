/**
 * Slots (spec §6): the runtime's one primitive for sharing values between the executions of an
 * instance. Every operation returns a future, and every wait in the language is on one.
 *
 * - **At once when it can.** A `put` on an empty slot, or a `take` or `read` on a full one,
 *   completes when it is called, and its future is already resolved. Anything else joins the
 *   slot's queue.
 * - **One queue,** longest waiter first, for every kind of operation. Whenever the slot changes,
 *   the queue is served from its head: while the slot is full, waiting reads yield its value and
 *   the first waiting take empties it; while it is empty, the first waiting put fills it. Serving
 *   stops at the first waiter the slot can't serve.
 * - A full slot therefore never has a take or read waiting, and an empty one never a put, so an
 *   operation that completes at once never jumps a waiter of its own kind.
 */

import type { Value } from '../../definition/values.ts';
import type { FutureState } from '../snapshot/objects.ts';
import type { Futures } from './futures.ts';
import { type Heap, handleObject, type LiveObjectOf } from './heap.ts';

export type SlotOperation = Extract<FutureState, { kind: 'slot' }>['operation'];

type SlotObject = LiveObjectOf<'slot'>;

export class Slots {
  readonly #heap: Heap;
  readonly #futures: Futures;

  constructor(heap: Heap, futures: Futures) {
    this.#heap = heap;
    this.#futures = futures;
  }

  /** A handle to a new, empty slot. */
  create(): Value {
    const slot = this.#heap.add((id): SlotObject => ({ kind: 'slot', id, waiting: [] }));
    return { kind: 'handle', object: slot.id };
  }

  /** A handle to the future of `operation` on the slot `handle` names; `value` is a put's. */
  operate(handle: Value, operation: SlotOperation, value: Value = null): Value {
    const slot = this.#heap.of(handleObject(handle), 'slot');
    const full = slot.value !== undefined;
    if ((operation === 'put') === full) {
      const future = this.#futures.create({
        kind: 'slot',
        slot: slot.id,
        operation,
        ...(operation === 'put' ? { value } : {}),
      });
      this.#heap.replace({ ...slot, waiting: [...slot.waiting, future] });
      return { kind: 'handle', object: future };
    }
    const { yielded, contents } = completed(slot.value, operation, value);
    this.#serve(slot, contents);
    return this.#futures.createHandle({ kind: 'resolved', value: yielded });
  }

  /**
   * Serves `slot`'s queue from its head as far as it can, the slot holding `contents`, and stores
   * the slot as it leaves it.
   */
  #serve(slot: SlotObject, held: Value | undefined): void {
    let contents = held;
    let served = 0;
    for (const head of slot.waiting) {
      const { state } = this.#heap.of(head, 'future');
      if (state.kind !== 'slot' || (state.operation === 'put') === (contents !== undefined)) {
        break;
      }
      const { yielded, contents: left } = completed(contents, state.operation, state.value ?? null);
      contents = left;
      served += 1;
      this.#futures.resolve(head, yielded);
    }
    const waiting = slot.waiting.slice(served);
    this.#heap.replace({ kind: 'slot', id: slot.id, waiting, ...valueField(contents) });
  }
}

/** A slot's contents after `operation` completes on `contents`, and what the operation yields. */
function completed(
  contents: Value | undefined,
  operation: SlotOperation,
  value: Value,
): { readonly yielded: Value; readonly contents: Value | undefined } {
  switch (operation) {
    case 'put':
      return { yielded: null, contents: value };
    case 'take':
      return { yielded: contents ?? null, contents: undefined };
    case 'read':
      return { yielded: contents ?? null, contents };
    default: {
      const unhandled: never = operation;
      return unhandled;
    }
  }
}

/** A slot's `value` field: present exactly when the slot is full. */
function valueField(contents: Value | undefined): { readonly value?: Value } {
  return contents === undefined ? {} : { value: contents };
}
