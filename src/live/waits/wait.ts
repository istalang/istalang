/**
 * A wait of a run of compiled code (proposal 8, Rule 5): decided once, by the first of its cases'
 * resolvers to resolve. Its waiter stops at it, and is resumed as the run's ready queue reaches it
 * (../ready.ts).
 */

import type { Value } from '../../definition/values/values.ts';
import { newObject } from '../values/cell.ts';
import type { Future } from './future.ts';

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
  /** Its waiter's call future, for a waiter that is an async call. */
  readonly call: Future | undefined;
  /** Whether the value deciding it reaches nothing counted, as its waiter knows: it holds none. */
  readonly plain: boolean;
  decision: Decision | undefined;
  /** Resumes its waiter, once it stopped at it. */
  #resume: ((decision: Decision) => void) | undefined;

  constructor(waiter: number, call: Future | undefined, plain: boolean) {
    this.waiter = waiter;
    this.call = call;
    this.plain = plain;
  }

  /** Whether its waiter stopped at it. */
  get stopped(): boolean {
    return this.#resume !== undefined;
  }

  /** Its waiter stops at it, `resume` resuming it with how it was decided. */
  stop(resume: (decision: Decision) => void): void {
    this.#resume = resume;
  }

  /** Resumes its waiter, stopped at it, as it was decided. */
  resume(): void {
    if (this.decision !== undefined) {
      this.#resume?.(this.decision);
    }
  }
}
