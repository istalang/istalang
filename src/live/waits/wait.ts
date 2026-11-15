/**
 * A wait of a run of compiled code (proposal 8, Rule 5): decided once, by the first of its cases'
 * resolvers to resolve. Its waiter awaits its `decided` promise, settled as it is decided, so
 * JavaScript resumes the waiter once it stopped at the wait and the wait is decided, after whatever
 * was readied before, as the interpreter's ready queue does: at its stop when decided before, at its
 * decision after.
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
  readonly decided: Promise<Decision>;
  readonly #settle: (decision: Decision) => void;

  constructor(waiter: number) {
    this.waiter = waiter;
    const { promise, resolve } = Promise.withResolvers<Decision>();
    this.decided = promise;
    this.#settle = resolve;
  }

  /** Decides it as `decision` says. */
  decide(decision: Decision): void {
    this.decision = decision;
    this.#settle(decision);
  }
}
