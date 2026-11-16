/**
 * Settling futures (§8): futures one event settles together call every callback waiting on any of
 * them at once, in the settle order: by rank (prelude.ista `Resolver`), then as they were added.
 * Then the run's own listeners hear each value, such as a call into a context waiting on its
 * invocation's future; what they settle meanwhile settles together after them, as futures following
 * these do (a mock's answer, mock-answers.ts).
 */

import type { Value } from '../../definition/values/values.ts';
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
    this.#called(this.#waitingOn(settling));
    const following: (readonly [Future, Value])[] = [];
    this.#following = following;
    try {
      for (const [future, value] of settling) {
        for (const listener of future.listeners.splice(0)) {
          listener(value);
        }
      }
    } finally {
      this.#following = undefined;
    }
    if (following.length > 0) {
      this.settleTogether(following);
    }
  }

  /** Settles each future not settled yet, a future listed twice with its first value; what waited. */
  #waitingOn(settling: Settling): Waited[] {
    const waiting: Waited[] = [];
    for (const [future, value] of settling) {
      if (!future.settled) {
        future.settled = true;
        future.value = value;
        for (const { callback, rank, standing } of future.callbacks.splice(0)) {
          waiting.push({ callback, rank, value });
          this.#lifetimes.letGo(standing);
        }
        this.#lifetimes.letGo(...future.onAwaited.splice(0));
      }
    }
    return waiting;
  }

  #called(waiting: readonly Waited[]): void {
    for (const { callback, value } of waiting.toSorted((first, second) =>
      compareRanks(first.rank, second.rank),
    )) {
      this.#lifetimes.letGo(this.#call(callback, value) as Value);
      this.#lifetimes.letGo(callback);
    }
  }
}

/** A callback waiting on a settled future, with its rank and the value it is called with. */
interface Waited {
  readonly callback: Value;
  readonly rank: readonly bigint[];
  readonly value: Value;
}

/** Ranks in order: element by element, a rank before the longer ranks it begins. */
function compareRanks(first: readonly bigint[], second: readonly bigint[]): number {
  for (let at = 0; at < Math.min(first.length, second.length); at += 1) {
    const a = first[at] ?? 0n;
    const b = second[at] ?? 0n;
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return first.length - second.length;
}
