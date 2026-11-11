/**
 * How the code a run executes waits (proposal 8, Rules 5 and 7): in an instance, ista, where every
 * wait commits; or in a live run, in memory, where a wait suspends until something settles on the
 * host's own event loop and resumes it.
 *
 * - A live run's wait on such a thing, a host's resolver or promise, gets a one-shot resume, the
 *   primitive a live resolver extends (live-resolvers.ts). Calling it only queues what it resolves
 *   and wakes the run's driver (live-run.ts), which applies one resume before each segment, as an
 *   instance takes one arrival, so code never runs inside a host's callback, and what a resume
 *   resolves is seen by that segment. A resume may instead fail its wait, which panics the run, as
 *   does a host's misuse of a resolver (`fail`).
 * - Whether a resume may still come is the run's futures' to say, not a count kept here: a future
 *   disposed before it resolved waits for nothing any more (§7).
 * - A resume called twice is a bug in the runtime: its resolver takes one value.
 */

import type { Persistence } from '../../foundation/language/well-known/index.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { RunContexts } from './run-contexts.ts';

/**
 * How a run waits: committing, or in memory, resumed through `resumes`, with the contexts its
 * runtimes run (§9).
 */
export type Waiting =
  | { readonly kind: Extract<Persistence, 'ista'> }
  | {
      readonly kind: Extract<Persistence, 'live'>;
      readonly resumes: LiveResumes;
      readonly contexts: RunContexts;
    };

/** How a live run waits. */
export type LiveWaiting = Extract<Waiting, { readonly kind: 'live' }>;

/** How an instance waits: every wait commits. */
export const istaWaiting: Waiting = { kind: 'ista' };

/** A wait that failed: its run panics with `message`, where the wait began (`trace`, §3.12). */
export interface FailedWait {
  readonly message: string;
  readonly trace: string;
}

/** Resumes a live run once from outside it with `value`. */
export type Resume<T> = (value: T) => void;

/** The resumes of one live run's waits, and the wake of its driver when one is called. */
export class LiveResumes {
  readonly #queued: (() => FailedWait | undefined)[] = [];
  /** A host's misuse, which ends the run whatever is queued and however its segment ended. */
  #misused: FailedWait | undefined;
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
   * Panics the run from outside it, as `failed` says, once its segment ends: before any resume
   * still queued, and even should the segment finish it, since a host's misuse ends the run
   * whatever it was given. The first misuse is the one it panics with.
   */
  fail(failed: FailedWait): void {
    this.#misused ??= failed;
    this.#wake?.();
  }

  /** The host's misuse the run panics with, if there was one. */
  get misused(): FailedWait | undefined {
    return this.#misused;
  }

  /** Whether a resume was called and not yet applied, or a misuse is to end the run. */
  get queued(): boolean {
    return this.#misused !== undefined || this.#queued.length > 0;
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
    if (this.#misused !== undefined) {
      return { failed: this.#misused };
    }
    const resolve = this.#queued.shift();
    return resolve === undefined ? undefined : { failed: resolve() };
  }

  #queue(apply: () => FailedWait | undefined): void {
    this.#queued.push(apply);
    this.#wake?.();
  }
}
