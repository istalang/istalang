/**
 * Time as a host keeps it (§5, §10): what a segment's start reads, and what a host waits on until
 * a timer is due. The runtime holds no timers of its own, so every wait is its host's, on the clock
 * the host gives: real time in a process (cli/clock.ts), or a manual clock, which jumps to whatever
 * time it is waited until, so a run on it takes no real time.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
  /** Settles once `now` reads `at` or later. */
  readonly until: (at: bigint) => Promise<void>;
}

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
