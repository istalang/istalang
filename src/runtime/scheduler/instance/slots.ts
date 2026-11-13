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
 *   cases are let go of then (spec §8): what one held, such as a losing async call's own pending
 *   take, must leave the queue unserved, which only collecting can tell. So serving stops before
 *   its next event while such losers await collecting, and the slot is owed serving, which goes on
 *   once collecting is done (`serveOwed`). Meanwhile every operation on it joins its queue.
 * - **Given up on, passed over.** Serving passes over an operation a losing case awaited, a wait
 *   decided otherwise, as a losing `select` case or `futures.first` entry is (spec §8), while no
 *   resolver registered on it is pending (`givenUp`): it consumes nothing, though something still
 *   holds it. One never given up on is served as it waits, and one awaited again is served where it
 *   stands. A `select` that doesn't wait awaits nothing, so it gives up on nothing.
 * - A full slot therefore never has a take or read waiting that it would serve, and an empty one
 *   never such a put, unless it is owed serving, so an operation that completes at once never jumps
 *   a waiter.
 */

import { handleTo, type Value } from '../../../definition/values/values.ts';
import type { HolderWrites } from '../../lifetimes/holder-writes.ts';
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
  readonly #holders: HolderWrites;
  readonly #futures: Futures;
  /** The slots whose serving paused while collecting was due, by id. */
  readonly #owed = new Set<number>();

  constructor(heap: Heap, holders: HolderWrites, futures: Futures) {
    this.#heap = heap;
    this.#holders = holders;
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
        givenUp: false,
      });
      this.#heap.replace({ ...slot, waiting: [...slot.waiting, future] });
      return handleTo(future);
    }
    const { yielded, contents } = completed(slot.value, operation, value);
    return this.#holders.handOver(yielded, () => {
      store(this.#heap, slot, slot.waiting, contents);
      this.#serve(slot.id);
      return this.#futures.createHandle({ kind: 'resolved', value: yielded });
    });
  }

  /**
   * A resolver now waits on the future `id`: a slot operation pending is served now if it can be,
   * as one given up on is once awaited again.
   */
  awaited(id: number): void {
    const { state } = this.#heap.of(id, 'future');
    if (state.kind === 'slot') {
      this.#serve(state.slot);
    }
  }

  /**
   * A case awaiting the future `id` lost (spec §8): a slot operation pending is given up on, passed
   * over while nothing else awaits it.
   */
  givenUp(id: number): void {
    const future = this.#heap.of(id, 'future');
    const { state } = future;
    if (state.kind === 'slot' && !state.givenUp) {
      this.#heap.replace({ ...future, state: { ...state, givenUp: true } });
    }
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
      const served = nextServed(slot, (future) => this.#servableState(future));
      if (served === undefined) {
        return;
      }
      if (this.#holders.losersUncollected) {
        this.#owed.add(id);
        return;
      }
      const resolved = new Set(served.resolutions.map((resolution) => resolution.id));
      const waiting = slot.waiting.filter((future) => !resolved.has(future));
      store(this.#heap, slot, waiting, served.contents);
      this.#futures.resolveTogether(served.resolutions);
    }
  }

  /** The state of the pending operation `id`; none while serving passes it over, given up on. */
  #servableState(id: number): FutureState | undefined {
    const { state } = this.#heap.of(id, 'future');
    const passedOver =
      state.kind === 'slot' && state.givenUp && this.#heap.find('resolvers', id).length === 0;
    return passedOver ? undefined : state;
  }
}

/**
 * The next event of serving `slot`'s queue: while it is full, the reads at its head, or else the
 * take there; while it is empty, the put there, the head being the longest waiter not passed over
 * (`stateOf` gives none). None when its head can't be served.
 */
function nextServed(
  slot: SlotObject,
  stateOf: (future: number) => FutureState | undefined,
): Served | undefined {
  const resolutions: Resolution[] = [];
  let contents = slot.value;
  const waiting = slot.waiting.flatMap((id) => {
    const state = stateOf(id);
    return state === undefined ? [] : [{ head: id, state }];
  });
  for (const { head, state } of waiting) {
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
