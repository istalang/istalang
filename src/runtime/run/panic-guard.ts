/**
 * Where a panic stops (§3.12): an ista instance's ends the instance at the run's outermost guarded
 * call, unwinding every call started within it (an async call's start, a call stopped as it is
 * disposed) as a plain callee's panic does, so no code of the instance runs past it, a host extern
 * call included. The live run's propagates to the host. While a termination disposes everything
 * past panics (§3.12), a guarded call's panic ends that call alone, as a `dispose`'s does
 * (disposal.ts), and the calls stopped after it still run their cleanup.
 */

import type { Instance } from './instances.ts';
import type { Traces } from './traces.ts';

export class PanicGuard {
  readonly #instance: Instance;
  readonly #traces: Pick<Traces, 'panicOf'>;
  /** Whether a panic is passed over now (`Lifetimes.disposingPastPanics`). */
  readonly #passesPanics: () => boolean;
  /** Whether a guarded call is running, which a panic in any call it started unwinds to. */
  #guarding = false;

  constructor(instance: Instance, traces: Pick<Traces, 'panicOf'>, passesPanics: () => boolean) {
    this.#instance = instance;
    this.#traces = traces;
    this.#passesPanics = passesPanics;
  }

  /** What `run` gives; undefined once it panicked, its panic ending the instance or passed over. */
  guarded<Result>(run: () => Result): Result | undefined {
    if (!this.#instance.durable || this.#guarding) {
      return run();
    }
    this.#guarding = true;
    try {
      return run();
    } catch (error) {
      const { message, trace } = this.#traces.panicOf(error);
      if (!this.#passesPanics()) {
        this.#instance.ended({ kind: 'panicked', message, trace });
      }
      return undefined;
    } finally {
      this.#guarding = false;
    }
  }
}
