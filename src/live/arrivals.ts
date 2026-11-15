/**
 * What reaches a run from outside its code: a host's answers and its timers coming due (spec §6),
 * each applied in a turn of the event loop of its own, as the interpreter applies one resume before
 * each segment (runtime/scheduler/waiting.ts). Two answers are two events: everything the first
 * readies runs, JavaScript draining its microtasks, before the second is applied.
 *
 * Timers due at one instant resolve together, the earliest instant first, once the clock reads it.
 */

import type { Clock } from '../runtime/clock.ts';

/** Runs `callback` in the event loop's next turn, after every microtask queued by now. */
const nextTurn: (callback: () => void) => void =
  typeof setImmediate === 'function'
    ? (callback) => setImmediate(callback)
    : (callback) => setTimeout(callback, 0);

export class Arrivals {
  readonly #queue: (() => void)[] = [];
  readonly #clock: Clock;
  readonly #stopped = new AbortController();
  /** The instants the clock is waited until, each once. */
  readonly #instants = new Set<bigint>();

  constructor(clock: Clock) {
    this.#clock = clock;
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

  /** Has `due` called, in a turn of its own, once the clock reads `at`. */
  at(at: bigint, due: () => void): void {
    if (this.#instants.has(at)) {
      return;
    }
    this.#instants.add(at);
    this.#clock.until(at, this.#stopped.signal).then(() => {
      this.#instants.delete(at);
      this.arrive(due);
    });
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
      }
    });
  }
}
