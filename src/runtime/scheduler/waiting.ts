/**
 * How the code a run executes waits (proposal 8, Rules 5 and 7): in an instance, ista, where every
 * wait commits; or in a live run, in memory, where a wait suspends until something settles on the
 * host's own event loop and resumes it.
 *
 * - A live run's wait on such a thing, a host's promise, gets a one-shot resume, the primitive R2's
 *   resolvers extend. Calling it only queues what it resolves and wakes the run's driver
 *   (live-run.ts), which applies the queue between its segments: code never runs inside a host's
 *   callback, and what a resume resolves is seen by the run's next segment, as an arrival is by an
 *   instance's.
 * - A resume called twice is a bug in the runtime: a promise settles once.
 */

import type { Persistence } from '../../definition/tables/functions.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';

/** How a run waits: committing, or in memory, resumed through `resumes`. */
export type Waiting =
  | { readonly kind: Extract<Persistence, 'ista'> }
  | { readonly kind: Extract<Persistence, 'live'>; readonly resumes: LiveResumes };

/** How an instance waits: every wait commits. */
export const istaWaiting: Waiting = { kind: 'ista' };

/** Resumes a live run once from outside it with `value`. */
export type Resume<T> = (value: T) => void;

/** The resumes of one live run's waits, and the wake of its driver when one is called. */
export class LiveResumes {
  readonly #queued: (() => void)[] = [];
  #outstanding = 0;
  #wake: (() => void) | undefined;

  /** A resume whose call applies `resolve` to its value, between the run's segments. */
  once<T>(resolve: (value: T) => void): Resume<T> {
    this.#outstanding += 1;
    let called = false;
    return (value) => {
      if (called) {
        unreachable('A live wait was resumed twice.');
      }
      called = true;
      this.#outstanding -= 1;
      this.#queued.push(() => {
        resolve(value);
      });
      this.#wake?.();
    };
  }

  /** Whether a resume is yet to be called or applied, so the run may still wake. */
  get pending(): boolean {
    return this.#outstanding > 0 || this.#queued.length > 0;
  }

  /** Settles once a resume has been called and not yet applied: at once when one has. */
  called(): Promise<void> {
    if (this.#queued.length > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#wake = () => {
        this.#wake = undefined;
        resolve();
      };
    });
  }

  /** Applies every resume called since the last time, in the order they were called. */
  apply(): void {
    for (const resolve of this.#queued.splice(0)) {
      resolve();
    }
  }
}
