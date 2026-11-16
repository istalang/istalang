/**
 * The run's timers (`time.at`, §6): a future each, settling at an instant in milliseconds since the
 * Unix epoch. Timers due at one instant settle together; one nothing holds any more no longer keeps
 * the run waiting, so it never comes due.
 */

import type { Future } from './objects/future.ts';

export interface Timer {
  readonly at: bigint;
  readonly future: Future;
}

export class Timers {
  #pending: Timer[] = [];

  add(timer: Timer): void {
    this.#pending.push(timer);
  }

  /** When the earliest timer still waited on comes due; undefined with none. */
  next(): bigint | undefined {
    let earliest: bigint | undefined;
    for (const { at, future } of this.#pending) {
      if (!future.settled && future.count > 0 && (earliest === undefined || at < earliest)) {
        earliest = at;
      }
    }
    return earliest;
  }

  /** Takes out the timers due at `at` that haven't settled; their futures. */
  takeDue(at: bigint): Future[] {
    const due = this.#pending.filter((timer) => timer.at === at && !timer.future.settled);
    this.#pending = this.#pending.filter((timer) => !due.includes(timer));
    return due.map(({ future }) => future);
  }

  persisted(): readonly Timer[] {
    return [...this.#pending];
  }

  restore(timers: readonly Timer[]): void {
    this.#pending = [...timers];
  }
}
