/**
 * A run's pending timers (spec §6): the futures due at each instant, resolved together with every
 * other due then, and the earliest one the run waits for (arrivals.ts). A timer nothing awaits any
 * more is gone (lifetimes/), and no longer wakes the run.
 */

import type { Future } from './waits/future.ts';

export class Timers {
  readonly #due = new Map<bigint, Future[]>();

  /** `future` resolves at `at`, in milliseconds since the Unix epoch. */
  add(at: bigint, future: Future): void {
    const due = this.#due.get(at);
    if (due === undefined) {
      this.#due.set(at, [future]);
    } else {
      due.push(future);
    }
  }

  /** `future`, a timer, is gone. */
  remove(future: Future): void {
    for (const [at, futures] of this.#due) {
      const left = futures.filter((each) => each !== future);
      if (left.length === 0) {
        this.#due.delete(at);
      } else {
        this.#due.set(at, left);
      }
    }
  }

  /** The earliest instant a timer is due at; none without timers. */
  next(): bigint | undefined {
    return [...this.#due.keys()].reduce<bigint | undefined>(
      (earliest, at) => (earliest === undefined || at < earliest ? at : earliest),
      undefined,
    );
  }

  /** The timers due by `now`, each instant's together, the earliest first, no longer pending. */
  takeDue(now: bigint): readonly (readonly Future[])[] {
    const instants = [...this.#due.keys()]
      .filter((at) => at <= now)
      .toSorted((first, second) => (first < second ? -1 : 1));
    return instants.map((at) => {
      const futures = this.#due.get(at) ?? [];
      this.#due.delete(at);
      return futures;
    });
  }
}
