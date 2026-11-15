/**
 * What a run of compiled code has ready to run, in the order it became ready (spec §6), as the
 * interpreter's ready queue (runtime/scheduler/instance/ready.ts): waiters whose wait was decided,
 * and the calls resolvers readied. One runs at a time, to its next stop, before the next begins.
 *
 * - A waiter is a generator the run resumes (run.ts), which runs to its next stop before resuming
 *   returns, so the queue drains in one synchronous pass, in order, whatever each item readies.
 * - The pass starts once the code readying the first item is done: in a microtask, so it runs
 *   before anything else reaches the run (arrivals.ts).
 */

export class Ready {
  readonly #queue: (() => void)[] = [];

  /** Readies `item`, run after everything readied before it. */
  add(item: () => void): void {
    this.#queue.push(item);
    if (this.#queue.length === 1) {
      queueMicrotask(this.#drain);
    }
  }

  /** Runs nothing more: the run ended. */
  stop(): void {
    this.#queue.length = 0;
  }

  /**
   * Runs every item readied, those readied meanwhile included, in order. Each stays queued while it
   * runs, so what it readies waits for this pass rather than starting another.
   */
  readonly #drain = (): void => {
    while (this.#queue.length > 0) {
      this.#queue[0]?.();
      this.#queue.shift();
    }
  };
}
