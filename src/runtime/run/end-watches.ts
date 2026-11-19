/**
 * Waits on other instances' ends (§17.1): a future settling with how the instance it watches ends,
 * which the world tells the run as a turn on that future (world.ts), so it lands in whichever run of
 * the instance goes on. A snapshot keeps each watch still pending, and a run restored from it asks
 * the world again.
 */

import type { Value } from '../../definition/values/values.ts';
import { type InstanceEnd, instanceEnding } from './instances.ts';
import type { Future } from './objects/future.ts';

/** A watch still pending, as a snapshot keeps it. */
export interface PendingWatch {
  readonly future: Future;
  readonly instance: string;
}

export class EndWatches {
  readonly #pending = new Map<Future, string>();
  readonly #ask: (watch: PendingWatch) => void;
  readonly #settle: (future: Future, value: Value) => void;

  /** Watches asking the world through `ask`, settled through `settle`. */
  constructor(ask: (watch: PendingWatch) => void, settle: (future: Future, value: Value) => void) {
    this.#ask = ask;
    this.#settle = settle;
  }

  /** Has `future` settle with how `instance` ends. */
  watch(watch: PendingWatch): void {
    this.#pending.set(watch.future, watch.instance);
    this.#ask(watch);
  }

  /** Settles `future`, a watch, with how the instance it watched ended. */
  ended(future: Future, end: InstanceEnd): void {
    this.#pending.delete(future);
    this.#settle(future, instanceEnding(end));
  }

  persisted(): PendingWatch[] {
    return [...this.#pending].map(([future, instance]) => ({ future, instance }));
  }
}
