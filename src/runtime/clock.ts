/**
 * Time as a host keeps it (§5, §10): what a segment's start reads, and what the runtime waits on
 * until a timer is due. The runtime holds no timers of its own, so every wait is on the clock the
 * host gives: real time (`realTime`), in a process or a browser, or a manual clock, which jumps to whatever
 * time it is waited until, so a run on it takes no real time.
 *
 * A wait can be called off, as one racing something that may wake its waiter first is: a far timer
 * then keeps no process alive once the race is over.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
  /** Settles once `now` reads `at` or later, or at once when `cancelled` aborts. */
  readonly until: (at: bigint, cancelled?: AbortSignal) => Promise<void>;
}

/** Real time: the system clock, and the event loop's timers to wait on it. */
export const realTime: Clock = {
  now: () => BigInt(Date.now()),
  until: (at, cancelled) =>
    new Promise((resolve) => {
      if (cancelled?.aborted === true) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, Math.max(0, Number(at - BigInt(Date.now()))));
      cancelled?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }),
};

/** A clock that reads the time it was set to, and moves on to what it is waited until. */
export class ManualClock implements Clock {
  #at: bigint;

  constructor(start = 0n) {
    this.#at = start;
  }

  readonly now = (): bigint => this.#at;

  readonly until = (at: bigint): Promise<void> => {
    if (at > this.#at) {
      this.#at = at;
    }
    return Promise.resolve();
  };

  /** Moves the clock to `at`, earlier or later. */
  set(at: bigint): void {
    this.#at = at;
  }
}
