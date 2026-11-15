/**
 * What a run of compiled code has ready to run, in the order it became ready (spec §6), as the
 * interpreter's ready queue (runtime/scheduler/instance/ready.ts): waiters whose wait was decided,
 * and the calls resolvers readied. One runs at a time, to its next stop, before the next begins.
 *
 * - JavaScript's microtasks alone can't keep that order: a continuation is queued when its promise
 *   settles, ahead of whatever was readied after it but before it ran, such as a wait's `onCancel`
 *   callbacks, which go right after its waiter.
 * - A waiter resumes as its wait's promise settles, which queues its continuation; the next item is
 *   queued only after it, so the waiter runs to its next stop first. Compiled code awaits nothing
 *   but its waits, so nothing else queues a continuation.
 */

export class Ready {
  readonly #queue: (() => void)[] = [];

  /** Readies `item`, run after everything readied before it. */
  add(item: () => void): void {
    this.#queue.push(item);
    if (this.#queue.length === 1) {
      queueMicrotask(this.#step);
    }
  }

  /** Runs nothing more: the run ended. */
  stop(): void {
    this.#queue.length = 0;
  }

  /** Runs the first item, then queues the next one's turn after what it queued. */
  readonly #step = (): void => {
    this.#queue[0]?.();
    this.#queue.shift();
    if (this.#queue.length > 0) {
      queueMicrotask(this.#step);
    }
  };
}
