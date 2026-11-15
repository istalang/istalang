/**
 * Slots in a run of compiled code (spec §6): the interpreter's rules (runtime/scheduler/instance/
 * slots.ts), over objects, which the differential runner holds the two to.
 *
 * - **At once when it can.** A `put` on an empty slot, or a `take` or `read` on a full one,
 *   completes when it is called, its future already resolved; anything else joins the queue.
 * - **One queue,** longest waiter first. Whenever the slot changes it is served from its head, one
 *   event at a time: while full, the reads at the head yield its value together, then the first
 *   take empties it; while empty, the first put fills it. Serving stops at the first waiter the
 *   slot can't serve.
 * - **Given up on, passed over:** an operation a losing case awaited consumes nothing while no
 *   resolver pending awaits it; awaited again, it is served where it stands.
 */

import type { Value } from '../../definition/values/values.ts';
import { Future, type SlotOperation } from '../waits/future.ts';
import type { Waits } from '../waits/waits.ts';
import type { Slot } from './slot.ts';

export class Slots {
  readonly #waits: Pick<Waits, 'resolveTogether' | 'awaited'>;
  /** The slot each pending operation's future waits in. */
  readonly #slotOf = new WeakMap<Future, Slot>();

  constructor(waits: Pick<Waits, 'resolveTogether' | 'awaited'>) {
    this.#waits = waits;
  }

  /** The future of `operation` on `slot`; `value` is a put's. */
  operate(slot: Slot, operation: SlotOperation['operation'], value: Value = null): Future {
    if ((operation === 'put') === (slot.contents !== undefined)) {
      const future = new Future({ operation, value, givenUp: false });
      this.#slotOf.set(future, slot);
      slot.waiting.push(future);
      return future;
    }
    const { yielded, contents } = completed(slot.contents, operation, value);
    slot.contents = contents;
    this.#serve(slot);
    const future = new Future();
    future.settled = { value: yielded };
    return future;
  }

  /** A resolver now waits on `future`: a pending slot operation is served now if it can be. */
  awaited(future: Future): void {
    const slot = this.#slotOf.get(future);
    if (slot !== undefined && future.settled === undefined) {
      this.#serve(slot);
    }
  }

  /** Serves `slot`'s queue from its head, event after event, as far as it can. */
  #serve(slot: Slot): void {
    for (;;) {
      const served = nextServed(slot, (future) => this.#waits.awaited(future));
      if (served === undefined) {
        return;
      }
      const resolved = new Set(served.resolutions.map(([future]) => future));
      slot.waiting = slot.waiting.filter((future) => !resolved.has(future));
      slot.contents = served.contents;
      this.#waits.resolveTogether(served.resolutions);
    }
  }
}

interface Served {
  readonly resolutions: (readonly [Future, Value])[];
  readonly contents: { readonly value: Value } | undefined;
}

/**
 * The next event of serving `slot`'s queue, passing over an operation given up on that nothing
 * `awaited`; none when its head can't be served.
 */
function nextServed(slot: Slot, awaited: (future: Future) => boolean): Served | undefined {
  const resolutions: (readonly [Future, Value])[] = [];
  let { contents } = slot;
  const servable = slot.waiting.filter(
    (future) => future.slot !== undefined && !(future.slot.givenUp && !awaited(future)),
  );
  for (const future of servable) {
    const { operation, value } = future.slot as SlotOperation;
    if (
      (operation === 'put') === (contents !== undefined) ||
      (operation !== 'read' && resolutions.length > 0)
    ) {
      break;
    }
    const { yielded, contents: left } = completed(contents, operation, value);
    resolutions.push([future, yielded]);
    contents = left;
    if (operation !== 'read') {
      break;
    }
  }
  return resolutions.length === 0 ? undefined : { resolutions, contents };
}

/** A slot's contents after `operation` completes on `contents`, and what the operation yields. */
function completed(
  contents: { readonly value: Value } | undefined,
  operation: SlotOperation['operation'],
  value: Value,
): { readonly yielded: Value; readonly contents: Served['contents'] } {
  switch (operation) {
    case 'put':
      return { yielded: null, contents: { value } };
    case 'take':
      return { yielded: contents?.value ?? null, contents: undefined };
    case 'read':
      return { yielded: contents?.value ?? null, contents };
    default: {
      const unhandled: never = operation;
      return unhandled;
    }
  }
}
