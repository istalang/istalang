/**
 * What reaches a run from outside its code: a host's answers and its timers coming due (spec §6),
 * each applied in a turn of the event loop of its own, as the interpreter applies one resume before
 * each segment (runtime/scheduler/live-run.ts). Two answers are two events: everything the first
 * readies runs, JavaScript draining its microtasks, before the second is applied.
 *
 * The clock is waited on only once the run is idle: nothing queued, every microtask drained, so a
 * manual clock, which jumps to what it is waited until, never jumps while code runs or an answer
 * waits to be applied. It is waited on for the earliest timer alone, again whenever the timers
 * change; once it reads that instant, the timers due by then resolve, in a turn of their own.
 */

import type { Clock } from '../runtime/clock.ts';

/** Runs `callback` in the event loop's next turn, after every microtask queued by now. */
const nextTurn: (callback: () => void) => void =
  typeof setImmediate === 'function'
    ? (callback) => setImmediate(callback)
    : (callback) => setTimeout(callback, 0);

/** What arrivals read of a run's timers. */
export interface Timers {
  /** The earliest instant a timer is due at; none without timers. */
  readonly next: () => bigint | undefined;
  /** Resolves the timers due by the clock. */
  readonly resolveDue: () => void;
}

export class Arrivals {
  readonly #queue: (() => void)[] = [];
  readonly #clock: Clock;
  readonly #timers: Timers;
  readonly #stopped = new AbortController();
  /** The wait on the clock for the earliest timer, while there is one. */
  #waiting: { readonly at: bigint; readonly cancel: AbortController } | undefined;

  constructor(clock: Clock, timers: Timers) {
    this.#clock = clock;
    this.#timers = timers;
  }

  /** Applies `event` in a turn of its own, after those that arrived before it. */
  arrive(event: () => void): void {
    if (this.#stopped.signal.aborted) {
      return;
    }
    this.#queue.push(event);
    if (this.#queue.length === 1) {
      this.#turn();
    }
  }

  /** The run's timers changed: once it is idle, the clock is waited on for the earliest. */
  timersChanged(): void {
    nextTurn(() => this.#waitForTimer());
  }

  /** Applies nothing more: the run ended. */
  stop(): void {
    this.#stopped.abort();
    this.#queue.length = 0;
  }

  /** Applies the first event queued in the event loop's next turn, then the next one's in its. */
  #turn(): void {
    nextTurn(() => {
      this.#queue[0]?.();
      this.#queue.shift();
      if (this.#queue.length > 0) {
        this.#turn();
      } else {
        nextTurn(() => this.#waitForTimer());
      }
    });
  }

  /** Waits on the clock for the earliest timer, unless something is queued or it already does. */
  #waitForTimer(): void {
    const at = this.#queue.length > 0 ? undefined : this.#timers.next();
    if (this.#stopped.signal.aborted || at === this.#waiting?.at) {
      return;
    }
    this.#waiting?.cancel.abort();
    this.#waiting = undefined;
    if (at === undefined) {
      return;
    }
    const cancel = new AbortController();
    const signal = AbortSignal.any([cancel.signal, this.#stopped.signal]);
    this.#waiting = { at, cancel };
    this.#clock.until(at, signal).then(() => {
      if (!signal.aborted) {
        this.#waiting = undefined;
        this.arrive(this.#timers.resolveDue);
      }
    });
  }
}
