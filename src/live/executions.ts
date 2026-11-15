/**
 * The async calls of a run of compiled code (spec §6, §7): each call's body is a generator the run
 * drives, so the run starts, resumes and stops it itself, synchronously, never waiting on
 * JavaScript's own scheduling.
 *
 * - **Running:** a call's body runs eagerly inside its caller up to its first wait, and later from
 *   the run's ready queue once its wait is decided, each time to its next wait or its end. A running
 *   call holds its own future (runtime/lifetimes/holders.ts), so only a suspended one can be
 *   disposed.
 * - **Stopping:** a call disposed while suspended stops where it waits: `return()` runs its body's
 *   `finally`, which lets go of what its frame held (codegen/code-entry.ts). One waiting on its own
 *   `disposing()` resumes at that case, runs its cleanup, and is stopped at its next wait (§7).
 * - **Its end:** a call that returned is no longer one to dispose: its weak reference loses it.
 */

import type { Future } from './waits/future.ts';
import type { Decision, Wait } from './waits/wait.ts';

/**
 * An async call's body: a generator that stops at each wait it yields, and is resumed with how the
 * wait was decided.
 */
export type Body = Generator<Wait, void, Decision | undefined>;

/** A suspended or running async call. */
export interface Execution<At> {
  readonly call: Future;
  readonly body: Body;
  /** What it sees as it runs: the run's `at` while it does. */
  at: At;
  /** The wait it is stopped at, while it is. */
  waiting: Wait | undefined;
  /** Whether it runs its cleanup, disposed. */
  cleaning: boolean;
}

/** What driving calls reaches of the run (run.ts). */
export interface ExecutionSeams<At> {
  /** Which execution runs, which the run's code and waits read. */
  at: At;
  readonly ended: boolean;
  readonly waits: {
    /** Stops at `wait` until `resume` is called with how it was decided. */
    readonly stopped: (wait: Wait, resume: (decision: Decision) => void) => void;
    /** The waiter of `wait` moves on from it, resumed or stopped: its pending cases lose (§8). */
    readonly ended: (wait: Wait) => void;
  };
  readonly lifetimes: {
    /** A holder came to hold, or let go of, `call`. */
    readonly hold: (call: Future) => void;
    readonly release: (call: Future) => void;
  };
  /** The call of future `call` returned or was stopped, so it can no longer be disposed. */
  readonly callEnded: (call: Future) => void;
}

export class Executions<At> {
  readonly #seams: ExecutionSeams<At>;
  /** The calls still running or suspended, by their future. */
  readonly #calls = new Map<Future, Execution<At>>();

  constructor(seams: ExecutionSeams<At>) {
    this.#seams = seams;
  }

  /** Runs `body`, the async call of `call`, seeing `at`, up to its first wait. */
  call(call: Future, body: Body, at: At): void {
    const execution: Execution<At> = { call, body, at, waiting: undefined, cleaning: false };
    this.#calls.set(call, execution);
    this.#resume(execution, undefined);
  }

  /** The call of future `call`, while it runs or is suspended. */
  of(call: Future): Execution<At> | undefined {
    return this.#calls.get(call);
  }

  /** Stops the suspended `execution` where it waits, letting go of what its frame holds. */
  stop(execution: Execution<At>): void {
    this.#moveOn(execution);
    this.#end(execution);
    this.#within(execution, () => {
      execution.body.return();
    });
  }

  /** Stops every call still suspended, oldest first, as the run lets go of what it held. */
  stopSuspended(): void {
    for (const execution of [...this.#calls.values()]) {
      if (execution.waiting !== undefined) {
        this.stop(execution);
      }
    }
  }

  /** Whether the call of future `call` runs its cleanup, disposed. */
  cleaning(call: Future): boolean {
    return this.#calls.get(call)?.cleaning === true;
  }

  /** Runs the cleanup of the disposed `execution`, resuming at case `position`, then stops it. */
  cleanup(execution: Execution<At>, position: number): void {
    execution.cleaning = true;
    this.#resume(execution, { position, value: null });
    if (this.#calls.has(execution.call)) {
      this.stop(execution);
    }
  }

  /**
   * Resumes `execution` with `decision`, to its next wait, or its end. What its body throws, a
   * panic or a bug, goes on through its caller, which stops there too, up to what the run runs.
   */
  #resume(execution: Execution<At>, decision: Decision | undefined): void {
    this.#moveOn(execution);
    this.#seams.lifetimes.hold(execution.call);
    try {
      this.#within(execution, () => {
        const next = execution.body.next(decision);
        if (next.done) {
          this.#end(execution);
          return;
        }
        const wait = next.value;
        execution.at = this.#seams.at;
        execution.waiting = wait;
        this.#seams.waits.stopped(wait, (decided) => {
          // A call disposed meanwhile was stopped, or resumed for its cleanup, already.
          if (!this.#seams.ended && execution.waiting === wait) {
            this.#resume(execution, decided);
          }
        });
      });
    } finally {
      this.#seams.lifetimes.release(execution.call);
    }
  }

  /** `execution` moves on from the wait it stopped at, if any. */
  #moveOn(execution: Execution<At>): void {
    const { waiting } = execution;
    execution.waiting = undefined;
    if (waiting !== undefined) {
      this.#seams.waits.ended(waiting);
    }
  }

  /** Runs `run` as `execution`, the run's `at` restored after. */
  #within(execution: Execution<At>, run: () => void): void {
    const caller = this.#seams.at;
    this.#seams.at = execution.at;
    try {
      run();
    } finally {
      this.#seams.at = caller;
    }
  }

  /** `execution` returned or was stopped: no longer a call to dispose. */
  #end(execution: Execution<At>): void {
    execution.waiting = undefined;
    this.#calls.delete(execution.call);
    this.#seams.callEnded(execution.call);
  }
}
