/**
 * Settling futures (§6): futures one event settles together call what waits on each of them (its
 * `waiting`, as the prelude keeps it) at once, future by future in the event's order: a future
 * widened follows its call's from the prelude (`_converted`), settling within that call's event.
 * Then the run's own listeners hear each value, such as a call into a context waiting on its
 * invocation's future; what they settle meanwhile settles together after them, as the answer of a
 * function another instance holds does (remote-calls.ts).
 */

import type { Value } from '../../definition/values/values.ts';
import type { Lifetimes } from './lifetimes.ts';
import { type Future, type Waiting, waitingValues } from './objects/future.ts';

/** Each future with the value it settles with, which it holds. */
export type Settling = readonly (readonly [Future, Value])[];

export class Settler {
  readonly #call: (callback: Value, value: Value) => unknown;
  readonly #lifetimes: Lifetimes;
  /** What the listeners of the futures settling now settle, together once they all have. */
  #settledByListeners: (readonly [Future, Value])[] | undefined;

  /** A settler calling waiting callbacks through `call`. */
  constructor(call: (callback: Value, value: Value) => unknown, lifetimes: Lifetimes) {
    this.#call = call;
    this.#lifetimes = lifetimes;
  }

  /** Settles each future with its value, calling what waits on them. */
  settleTogether(settling: Settling): void {
    if (this.#settledByListeners !== undefined) {
      this.#settledByListeners.push(...settling);
      return;
    }
    this.#called(waitingOn(settling));
    const settledByListeners: (readonly [Future, Value])[] = [];
    this.#settledByListeners = settledByListeners;
    try {
      for (const [future] of settling) {
        for (const listener of future.listeners.splice(0)) {
          listener(future.value);
        }
      }
    } finally {
      this.#settledByListeners = undefined;
    }
    if (settledByListeners.length > 0) {
      this.settleTogether(settledByListeners);
    }
  }

  #called(waited: readonly Waited[]): void {
    for (const { waiting, value } of waited) {
      this.#lifetimes.letGo(this.#call(waiting.arrived, value) as Value);
      this.#lifetimes.letGo(...waitingValues(waiting));
    }
  }
}

/** Settles each future not settled yet, a future listed twice with its first value; what waited. */
function waitingOn(settling: Settling): Waited[] {
  const waited: Waited[] = [];
  for (const [future, value] of settling) {
    if (!future.settled) {
      future.settled = true;
      future.value = value;
      if (future.waiting !== undefined) {
        waited.push({ waiting: future.waiting, value });
        future.waiting = undefined;
      }
    }
  }
  return waited;
}

/** What waited on a settled future, with the value it is called with. */
interface Waited {
  readonly waiting: Waiting;
  readonly value: Value;
}
