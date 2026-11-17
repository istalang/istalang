/**
 * Settling futures (§6): futures one event settles together call every callback waiting on any of
 * them at once, future by future in the event's order, each future's in the order they were added.
 * A future following one of them (following.ts) settles with them, its value converted.
 * Then the run's own listeners hear each value, such as a call into a context waiting on its
 * invocation's future; what they settle meanwhile settles together after them, as futures following
 * these do (a mock's answer, mock-answers.ts).
 */

import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { convertedFollowing, unfollowed } from './following.ts';
import type { Lifetimes } from './lifetimes.ts';
import type { Future } from './objects/future.ts';

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

  /** Settles each future with its value, calling the callbacks waiting on them. */
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
    const waiting: Waited[] = [];
    const settled = [...settling];
    for (const [future, value] of settled) {
      if (!future.settled) {
        future.settled = true;
        future.value = value;
        for (const { callback, standing, cancelled } of future.callbacks.splice(0)) {
          waiting.push({ callback, value });
          this.#lifetimes.letGo(standing, cancelled);
        }
        this.#lifetimes.letGo(...future.onAwaited.splice(0));
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
    return waiting;
  }

  #called(waiting: readonly Waited[]): void {
    for (const { callback, value } of waiting) {
      this.#lifetimes.letGo(this.#call(callback, value) as Value);
      this.#lifetimes.letGo(callback);
    }
  }
}

/** A callback waiting on a settled future, with the value it is called with. */
interface Waited {
  readonly callback: Value;
  readonly value: Value;
}
