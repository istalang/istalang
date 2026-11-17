/**
 * Settling futures (§6): futures one event settles together call what waits on each of them (its
 * `waiting`, as the prelude keeps it) at once, future by future in the event's order.
 * A future following one of them (following.ts) settles with them, its value converted.
 * Then the run's own listeners hear each value, such as a call into a context waiting on its
 * invocation's future; what they settle meanwhile settles together after them, as futures following
 * these do (a mock's answer, mock-answers.ts).
 */

import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { convertedFollowing, unfollowed } from './following.ts';
import type { Lifetimes } from './lifetimes.ts';
import { type Future, type Waiting, waitingValues } from './objects/future.ts';

/** Each future with the value it settles with, which it holds. */
export type Settling = readonly (readonly [Future, Value])[];

export class Settler {
  readonly #call: (callback: Value, value: Value) => unknown;
  readonly #lifetimes: Lifetimes;
  /** What the listeners of the futures settling now settle, together once they all have. */
  #following: (readonly [Future, Value])[] | undefined;

  /** A settler calling waiting callbacks through `call`. */
  constructor(call: (callback: Value, value: Value) => unknown, lifetimes: Lifetimes) {
    this.#call = call;
    this.#lifetimes = lifetimes;
  }

  /** Settles each future with its value, calling what waits on them. */
  settleTogether(settling: Settling): void {
    if (this.#following !== undefined) {
      this.#following.push(...settling);
      return;
    }
    const followed: Value[] = [];
    this.#called(this.#waitingOn(settling, followed));
    this.#lifetimes.letGo(...followed);
    const following: (readonly [Future, Value])[] = [];
    this.#following = following;
    try {
      for (const [future] of settling) {
        for (const listener of future.listeners.splice(0)) {
          listener(future.value);
        }
      }
    } finally {
      this.#following = undefined;
    }
    if (following.length > 0) {
      this.settleTogether(following);
    }
  }

  /**
   * Settles each future not settled yet, a future listed twice with its first value, and with them
   * the futures following each (following.ts), which let go of what they followed into
   * `followed`; what waited.
   */
  #waitingOn(settling: Settling, followed: Value[]): Waited[] {
    const waited: Waited[] = [];
    const settled = [...settling];
    for (const [future, value] of settled) {
      if (!future.settled) {
        future.settled = true;
        future.value = value;
        if (future.waiting !== undefined) {
          waited.push({ waiting: future.waiting, value });
          future.waiting = undefined;
        }
        for (const follower of [...future.followers]) {
          const { converter } =
            unfollowed(follower) ?? unreachable('A follower follows its future.');
          followed.push(future as unknown as Value);
          settled.push([
            follower,
            convertedFollowing(this.#call, this.#lifetimes, converter, value),
          ]);
        }
      }
    }
    return waited;
  }

  #called(waited: readonly Waited[]): void {
    for (const { waiting, value } of waited) {
      this.#lifetimes.letGo(this.#call(waiting.arrived, value) as Value);
      this.#lifetimes.letGo(...waitingValues(waiting));
    }
  }
}

/** What waited on a settled future, with the value it is called with. */
interface Waited {
  readonly waiting: Waiting;
  readonly value: Value;
}
