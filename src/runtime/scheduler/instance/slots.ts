/**
 * Slots (spec §6): the runtime's one primitive for sharing values between the executions of an
 * instance. Every operation returns a future, and every wait in the language is on one.
 *
 * - **At once when it can.** A `put` on an empty slot, or a `take` or `read` on a full one,
 *   completes when it is called, and its future is already resolved. Anything else joins the
 *   slot's queue.
 * - **One queue,** longest waiter first, for every kind of operation. Whenever the slot changes,
 *   the queue is served from its head, one event at a time: while the slot is full, the reads
 *   waiting at the head yield its value together, and then the first waiting take empties it;
 *   while it is empty, the first waiting put fills it. Serving stops at the first waiter the slot
 *   can't serve.
 * - **Serving pauses for a decided `select`'s losers.** An event may decide a `select`, whose losing
 *   cases are let go of then (spec §8): one still queued here must leave the queue unserved, which
 *   only collecting can tell. So serving stops before its next event while such losers await
 *   collecting, and the slot is owed serving, which goes on once collecting is done
 *   (`serveOwed`). Meanwhile every operation on it joins its queue.
 * - A full slot therefore never has a take or read waiting, and an empty one never a put, unless
 *   it is owed serving, so an operation that completes at once never jumps a waiter.
 */

import { handleTo, type Value } from '../../../definition/values/values.ts';
import type { FutureState } from '../../snapshot/objects.ts';
import type { Futures, Resolution } from './futures.ts';
import { type Heap, handleObject, type LiveObjectOf } from './heap.ts';

export type SlotOperation = Extract<FutureState, { kind: 'slot' }>['operation'];

type SlotObject = LiveObjectOf<'slot'>;

/** One event of serving a queue: the waiters it resolves together, and what the slot then holds. */
interface Served {
  readonly resolutions: readonly Resolution[];
  readonly contents: Value | undefined;
}

export class Slots {
  readonly #heap: Heap;
  readonly #futures: Futures;
  /** The slots whose serving paused while collecting was due, by id. */
  readonly #owed = new Set<number>();

  constructor(heap: Heap, futures: Futures) {
    this.#heap = heap;
    this.#futures = futures;
  }

  /** A handle to a new, empty slot. */
  create(): Value {
    const slot = this.#heap.add((id): SlotObject => ({ kind: 'slot', id, waiting: [] }));
    return handleTo(slot.id);
  }

  /** A handle to the future of `operation` on the slot `handle` names; `value` is a put's. */
  operate(handle: Value, operation: SlotOperation, value: Value = null): Value {
    const slot = this.#heap.of(handleObject(handle), 'slot');
    const full = slot.value !== undefined;
    if (this.#owed.has(slot.id) || (operation === 'put') === full) {
      const future = this.#futures.create({
        kind: 'slot',
        slot: slot.id,
        operation,
        ...(operation === 'put' ? { value } : {}),
      });
      this.#heap.replace({ ...slot, waiting: [...slot.waiting, future] });
      return handleTo(future);
    }
    const { yielded, contents } = completed(slot.value, operation, value);
    store(this.#heap, slot, slot.waiting, contents);
    this.#serve(slot.id);
    return this.#futures.createHandle({ kind: 'resolved', value: yielded });
  }

  /** Serves the queues whose serving paused, now that collecting is done; whether there were any. */
  serveOwed(): boolean {
    const owed = [...this.#owed];
    this.#owed.clear();
    for (const id of owed) {
      if (this.#heap.has(id)) {
        this.#serve(id);
      }
    }
    return owed.length > 0;
  }

  /** Serves the queue of the slot `id` from its head, event after event, as far as it can. */
  #serve(id: number): void {
    for (;;) {
      const slot = this.#heap.of(id, 'slot');
      const served = nextServed(slot, (future) => this.#heap.of(future, 'future').state);
      if (served === undefined) {
        return;
      }
      if (this.#heap.losersUncollected) {
        this.#owed.add(id);
        return;
      }
      store(this.#heap, slot, slot.waiting.slice(served.resolutions.length), served.contents);
      this.#futures.resolveTogether(served.resolutions);
    }
  }
}

/**
 * The next event of serving `slot`'s queue: while it is full, the reads at its head, or else the
 * take there; while it is empty, the put there. None when its head can't be served.
 */
function nextServed(
  slot: SlotObject,
  stateOf: (future: number) => FutureState,
): Served | undefined {
  const resolutions: Resolution[] = [];
  let contents = slot.value;
  for (const head of slot.waiting) {
    const state = stateOf(head);
    const servable =
      state.kind === 'slot' && (state.operation === 'put') !== (contents !== undefined);
    if (!servable || (state.operation !== 'read' && resolutions.length > 0)) {
      break;
    }
    const { yielded, contents: left } = completed(contents, state.operation, state.value ?? null);
    resolutions.push({ id: head, value: yielded });
    contents = left;
    if (state.operation !== 'read') {
      break;
    }
  }
  return resolutions.length === 0 ? undefined : { resolutions, contents };
}

/** Stores `slot` with `waiting` as its queue, holding `contents`. */
function store(
  heap: Heap,
  slot: SlotObject,
  waiting: readonly number[],
  contents: Value | undefined,
): void {
  heap.replace({ kind: 'slot', id: slot.id, waiting: [...waiting], ...valueField(contents) });
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
