/**
 * The runtimes live code opens over the host's store (§9), and the instances whose jobs they
 * serve (runtime.ista `_served`, §5).
 *
 * - Opening one while none is open resumes the work persisted in the store (durable-world.ts): the
 *   instances there that haven't ended are read back, and the world runs them on.
 * - **Lives.** What a runtime serves is the lives begun since then: each instance running then or
 *   made since, and each a retry runs again, whose panic ended the loop serving it, in the order
 *   they began. A loop serving one calls functions of its own program, so a runtime serves only the
 *   instances running its live code's program (§5, versioning).
 * - **One loop each.** Only the earliest runtime open serves, so two never take turns ringing each
 *   other's loop out; one opened later serves once those before it are closed. A wait hears the
 *   names once they are more than it knows, all of them, in order, as an array settling its live
 *   future; one let go of first is withdrawn.
 */

import type { Future } from '../run/objects/future.ts';
import type { Run } from '../run/run.ts';

/** A runtime's wait for the names of the instances it serves, once more than `known`. */
interface ServedWait {
  readonly runtime: number;
  readonly known: number;
  readonly future: Future;
}

/** An instance that began to run, and the hash of the program it runs. */
interface Life {
  readonly name: string;
  readonly program: string;
}

export class OpenRuntimes {
  /** The hash of the program each open runtime's live code runs, by number, earliest first. */
  readonly #open = new Map<number, string>();
  #opened = 0;
  #lives: Life[] = [];
  /** Each wait, with how it is answered. */
  readonly #waits = new Map<ServedWait, (names: readonly string[]) => void>();

  /**
   * Opens a runtime for live code running the program `program`; its number. Opening the first,
   * `resume` has the store's work begin.
   */
  open(program: string, resume: () => void): number {
    const first = this.#open.size === 0;
    this.#opened += 1;
    this.#open.set(this.#opened, program);
    if (first) {
      this.#lives = [];
      resume();
    }
    this.#answer();
    return this.#opened;
  }

  /** Closes runtime `runtime`: its waits are dropped, and the next earliest serves. */
  close(runtime: number): void {
    this.#open.delete(runtime);
    for (const wait of this.#waits.keys()) {
      if (wait.runtime === runtime) {
        this.#waits.delete(wait);
      }
    }
    this.#answer();
  }

  /** The instance `name`, running the program `program`, began to run. */
  began(name: string, program: string): void {
    if (this.#open.size > 0) {
      this.#lives.push({ name, program });
      this.#answer();
    }
  }

  /** Has `wait`, a wait of `waiter`'s, answered once its runtime serves more than it knows. */
  served(waiter: Run, wait: ServedWait): void {
    const { future } = wait;
    this.#waits.set(wait, (names) =>
      waiter.arrivals.arrive(future, (run, answered) =>
        run.settle(answered, { kind: 'array', elements: [...names] }),
      ),
    );
    future.cancels.push(() => this.#waits.delete(wait));
    this.#answer();
  }

  /** Answers the waits of the earliest open runtime that know fewer than it serves. */
  #answer(): void {
    const [earliest] = this.#open;
    if (earliest === undefined) {
      return;
    }
    const [runtime, program] = earliest;
    const names = this.#lives.filter((life) => life.program === program).map(({ name }) => name);
    for (const [wait, answer] of this.#waits) {
      if (wait.runtime === runtime && names.length > wait.known) {
        this.#waits.delete(wait);
        answer(names);
      }
    }
  }
}
