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

/** A piece of readied work, and what lets go of what it holds if it never runs. */
interface Item {
  readonly run: () => void;
  readonly drop: () => void;
}

export class Ready {
  readonly #queue: Item[] = [];
  /** The item running, which closing leaves to finish. */
  #running: Item | undefined;

  /** Readies `run`, run after everything readied before it; `drop` lets go of it if it never runs. */
  add(run: () => void, drop: () => void = () => undefined): void {
    this.#queue.push({ run, drop });
    if (this.#queue.length === 1) {
      queueMicrotask(this.#drain);
    }
  }

  /** Runs nothing more: the run ended. */
  stop(): void {
    this.#queue.length = 0;
  }

  /** Runs nothing more, letting go of what it readied, as the run lets go of what it held. */
  close(): void {
    for (const item of this.#queue.splice(0)) {
      if (item !== this.#running) {
        item.drop();
      }
    }
  }

  /**
   * Runs every item readied, those readied meanwhile included, in order. Each stays queued while it
   * runs, so what it readies waits for this pass rather than starting another.
   */
  readonly #drain = (): void => {
    for (let [item] = this.#queue; item !== undefined; [item] = this.#queue) {
      this.#running = item;
      item.run();
      this.#running = undefined;
      if (this.#queue[0] === item) {
        this.#queue.shift();
      }
    }
  };
}
