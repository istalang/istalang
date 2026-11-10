/**
 * How the code a run executes waits (proposal 8, Rules 5 and 7): in an instance, ista, where every
 * wait commits; or in a live run, in memory, where a wait suspends until something settles on the
 * host's own event loop and resumes it.
 *
 * - A live run's wait on such a thing, a host's resolver or promise, gets a one-shot resume, the
 *   primitive a live resolver extends (live-resolvers.ts). Calling it only queues what it resolves
 *   and wakes the run's driver (live-run.ts), which applies one resume before each segment, as an
 *   instance takes one arrival, so code never runs inside a host's callback, and what a resume
 *   resolves is seen by that segment. A resume may instead fail its wait, which panics the run. So does
 *   JSON a host gave that doesn't fit: it came with no host call that could be refused for it
 *   (§3.12), and so does a host's misuse of a resolver (`fail`).
 * - Whether a resume may still come is the run's futures' to say, not a count kept here: a future
 *   disposed before it resolved waits for nothing any more (§7).
 * - A resume called twice is a bug in the runtime: its resolver takes one value.
 */

import type { Persistence } from '../../foundation/language/well-known/index.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { Panic } from '../natives.ts';
import { Refusal } from '../refusal.ts';
import { panicOf } from './segment/limits.ts';

/** How a run waits: committing, or in memory, resumed through `resumes`. */
export type Waiting =
  | { readonly kind: Extract<Persistence, 'ista'> }
  | { readonly kind: Extract<Persistence, 'live'>; readonly resumes: LiveResumes };

/** How an instance waits: every wait commits. */
export const istaWaiting: Waiting = { kind: 'ista' };

/** A wait that failed: its run panics with `message`, where the wait began (`trace`, §3.12). */
export interface FailedWait {
  readonly message: string;
  readonly trace: string;
}

/** What panics a live run once it resumed: a panic, or JSON a host's promise gave that doesn't fit. */
export function resumedPanicOf(error: unknown): Panic | undefined {
  if (error instanceof Refusal && error.reason === 'unfitJson') {
    return new Panic(`The host gave what doesn't fit: ${error.message}`, { cause: error });
  }
  return panicOf(error);
}

/** Resumes a live run once from outside it with `value`. */
export type Resume<T> = (value: T) => void;

/** The resumes of one live run's waits, and the wake of its driver when one is called. */
export class LiveResumes {
  readonly #queued: (() => FailedWait | undefined)[] = [];
  #wake: (() => void) | undefined;

  /**
   * A resume whose call applies `resolve` to its value between the run's segments; what `resolve`
   * gives back, when anything, fails the wait.
   */
  once<T>(resolve: (value: T) => FailedWait | undefined): Resume<T> {
    let called = false;
    return (value) => {
      if (called) {
        unreachable('A live wait was resumed twice.');
      }
      called = true;
      this.#queue(() => resolve(value));
    };
  }

  /**
   * Panics the run from outside it, as `failed` says, at its next segment: before any resume still
   * queued, since a host's misuse ends the run whatever it was given.
   */
  fail(failed: FailedWait): void {
    this.#queued.unshift(() => failed);
    this.#wake?.();
  }

  /** Whether a resume was called and not yet applied. */
  get queued(): boolean {
    return this.#queued.length > 0;
  }

  /** Settles once a resume has been called and not yet applied: at once when one has. */
  called(): Promise<void> {
    if (this.queued) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#wake = () => {
        this.#wake = undefined;
        resolve();
      };
    });
  }

  /**
   * Applies the earliest resume called and not yet applied: undefined when there is none, else
   * whether it failed its wait, after which the run applies nothing more.
   */
  applyNext(): { readonly failed: FailedWait | undefined } | undefined {
    const resolve = this.#queued.shift();
    return resolve === undefined ? undefined : { failed: resolve() };
  }

  #queue(apply: () => FailedWait | undefined): void {
    this.#queued.push(apply);
    this.#wake?.();
  }
}
