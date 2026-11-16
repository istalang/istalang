/**
 * Calls into an instance (§9): each an invocation of a closure, answered with what its call gave or
 * how the instance ended first.
 *
 * - The **root** invocation is an instance's spawned call: its end is the instance's, which a
 *   snapshot keeps, so it never waits on the instance's end besides.
 * - Any other waits on the instance's end until its call returns, then stops waiting: a context's
 *   panic answers every call still running in it, and no call that already returned.
 */

import type { Value } from '../../definition/values/values.ts';
import type { Instance, InvocationEnd } from './instances.ts';
import type { Future } from './objects/future.ts';

/**
 * An invocation's answer: told how the call into the instance ended. Its caller hears the
 * instance's panic (`hears`), but for the loop serving jobs, whose instance's panic stays the
 * host's to hear (§9), and the root's, whose end is the instance's own.
 */
export interface Invocation {
  readonly answer: (end: InvocationEnd) => void;
  readonly root: boolean;
  readonly hears: boolean;
}

/** An invocation still running, by the future of the call it started, as a snapshot keeps it. */
export interface RunningInvocation {
  readonly future: Future;
  readonly invocation: Invocation;
}

export class Invocations {
  readonly #instance: Instance;
  readonly #running = new Map<Future, Invocation>();

  constructor(instance: Instance) {
    this.#instance = instance;
  }

  /** Has `invocation` hear the instance's end until its call returns. */
  waitOnEnd(invocation: Invocation): void {
    const { endWatchers } = this.#instance;
    if (!(invocation.root || endWatchers.includes(invocation))) {
      endWatchers.push(invocation);
    }
  }

  /** Answers `invocation` as `future`, its call's, settles, or as the instance ends first. */
  attach(future: Future, invocation: Invocation): void {
    this.waitOnEnd(invocation);
    const returned = (value: Value) => {
      this.#running.delete(future);
      this.answer(invocation, value, future as unknown as Value);
    };
    if (future.settled) {
      returned(future.value);
    } else {
      this.#running.set(future, invocation);
      future.listeners.push(returned);
    }
  }

  /**
   * Tells `invocation` its call returned `value`, which `holder` holds, no longer waiting on the
   * instance's end.
   */
  answer(invocation: Invocation, value: Value, holder: Value = value): void {
    const { endWatchers } = this.#instance;
    const at = endWatchers.indexOf(invocation);
    if (at >= 0) {
      endWatchers.splice(at, 1);
    }
    invocation.answer({ kind: 'returned', value, holder });
  }

  persisted(): RunningInvocation[] {
    return [...this.#running].map(([future, invocation]) => ({ future, invocation }));
  }
}
