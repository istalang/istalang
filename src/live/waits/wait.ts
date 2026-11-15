/**
 * A wait of a run of compiled code (proposal 8, Rule 5): decided once, by the first of its cases'
 * resolvers to resolve. Its waiter stops at it awaiting the promise `stop` gives, which settles
 * when the run's ready queue reaches the waiter (../ready.ts).
 */

import type { Value } from '../../definition/values/values.ts';
import { newObject } from '../values/cell.ts';

/** How a wait was decided: the case that won, by position (an `await`'s is 0), and its value. */
export interface Decision {
  readonly position: number;
  readonly value: Value;
}

export class Wait {
  readonly kind = 'handle';
  readonly object = newObject();
  /** Its waiter's creation, which orders waits decided together. */
  readonly waiter: number;
  decision: Decision | undefined;
  /** Resumes its waiter, once it stopped at it. */
  #resume: ((decision: Decision) => void) | undefined;

  constructor(waiter: number) {
    this.waiter = waiter;
  }

  /** Whether its waiter stopped at it. */
  get stopped(): boolean {
    return this.#resume !== undefined;
  }

  /** Its waiter stops at it: how it is decided, once its waiter resumes. */
  stop(): Promise<Decision> {
    const { promise, resolve } = Promise.withResolvers<Decision>();
    this.#resume = resolve;
    return promise;
  }

  /** Resumes its waiter, stopped at it, as it was decided. */
  resume(): void {
    if (this.decision !== undefined) {
      this.#resume?.(this.decision);
    }
  }
}
