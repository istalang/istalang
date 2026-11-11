/**
 * The contexts a live run reaches (§9): instances named by key, in its host's store, which ista
 * code runs in. The host makes them for the run (runtime/host/contexts.ts); the run calls into
 * them through the runtimes it opens, and drives them while it waits (live-run.ts), so they run
 * while it does and stop when it ends, resuming at the next open of their store.
 *
 * - A call into a context is an invocation, answered as a call to a mock is (segment/answering.ts):
 *   its listener gets the value its call gave, or the context's panic, which ends every call
 *   into it still waiting.
 * - Driving is in the run's own loop: what can run in its contexts runs before it waits, its wait
 *   lasts until the earliest timer of either, and when neither has anything that can wake it, it
 *   ends waiting on nothing, as an instance whose waits nothing can wake does.
 */

import type { Value } from '../../definition/values/values.ts';
import type { InstanceCall } from '../snapshot/snapshot.ts';

/**
 * Who makes a call into a context: the program, whose call hears the context's panic, so the host
 * doesn't, or the runtime's loop serving the context's jobs, which leaves the panic to the host as
 * though no call waited (§9; stdlib/runtime/runtime.ista).
 */
export type CallMaker = 'program' | 'jobs';

/**
 * A call into the context named `key`: what it calls, its values as they left the run, the live
 * future waiting on it, its listener, and who makes it.
 */
export interface ContextCall {
  readonly key: string;
  readonly call: InstanceCall;
  readonly future: number;
  readonly listener: CallListener;
  readonly maker: CallMaker;
}

/**
 * A wait for the names of the instances the runtime numbered `runtime` serves the jobs of, once
 * they are more than `known`, and the live future waiting on them.
 */
export interface ServedWait {
  readonly runtime: number;
  readonly known: number;
  readonly future: number;
  readonly listener: (instances: readonly string[]) => void;
}

/** How a call into a context ended, as its caller hears it. */
export interface CallListener {
  /** The call gave `value`, which has left the context. */
  readonly answered: (value: Value) => void;
  /** The context panicked, or had ended or panicked, before the call gave anything. */
  readonly panicked: (panic: { readonly message: string; readonly trace: string }) => void;
}

export interface RunContexts {
  /** Opens a runtime over the host's store, resuming the work persisted there; its number. */
  readonly open: () => number;
  /** Makes `call` into its context, made if new, through the runtime numbered `runtime`. */
  readonly call: (runtime: number, call: ContextCall) => void;
  /**
   * Has `wait` hear the names of every instance the runtimes drive, in the order they joined, once
   * they are more than it knows and its runtime is the earliest still open: one runtime serves
   * every instance's jobs at a time (stdlib/runtime/runtime.ista).
   */
  readonly served: (wait: ServedWait) => void;
  /**
   * Stops the runtime numbered `runtime`: its contexts run on only while another is open, but the
   * calls made through it still start.
   */
  readonly dispose: (runtime: number) => void;
  /** Runs everything that can run now in the contexts; whether anything did. */
  readonly runReady: () => Promise<boolean>;
  /** Starts every call made so far, whether or not a runtime is still open. */
  readonly startCalls: () => Promise<void>;
  /** The earliest time a context waits until; undefined when none waits on a timer. */
  readonly nextTimer: () => bigint | undefined;
  /** Wakes the contexts whose timer is due by `now`. */
  readonly wakeDue: (now: bigint) => Promise<void>;
  /** Whether the live future `future` waits on the contexts: a call into one, or `served`. */
  readonly awaitsContexts: (future: number) => boolean;
  /** Whether a context waits on a future its host may still fill, which may wake it whenever. */
  readonly awaitsHost: () => boolean;
  /** Settles once whether the host may still fill could have changed. */
  readonly fillsChanged: () => Promise<void>;
  /** Has `poke` called whenever something else than the run advanced its contexts: a host's fill. */
  readonly runOn: (poke: () => void) => void;
  /** Stops the contexts as the run ends: what they do from then on is the store's. */
  readonly close: () => void;
}
