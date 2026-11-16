/**
 * The natives of the run's own primitives (ir-first design, decision 6): what the prelude's futures,
 * resolvers and waits, written in Istalang, stand on. Every backend implements these; nothing else
 * of the run is reachable from Istalang.
 *
 * - A future keeps the callbacks waiting on it with their rank (prelude.ista `Resolver`), and the
 *   run calls them in rank order as it settles (`Run.settle`). Each comes with what says what its
 *   resolver stands for: one that can't decide any more is dropped as another comes or is asked
 *   about, and a future one of those lost on, with nothing waiting on it, is given up on, which a
 *   slot passes over (§6, §8). A withdrawn one, a `select`'s that didn't wait, gives up on nothing.
 * - `_later` readies a call of its own, as a `Resolver.of` callback and an `onCancel` run (§8).
 * - `_unpark` readies a parked call to resume with its wait's decided position; a wait decided
 *   before its call parks readies it all the same, as awaiting still yields (§6), unless the call
 *   goes on without parking (`_stayRunning`), as a `select` that doesn't wait does.
 */

import type { Value } from '../../definition/values/values.ts';
import type { Natives } from '../natives.ts';
import type { Execution } from './objects/execution.ts';
import { Future, type Waiting } from './objects/future.ts';
import type { Run } from './run.ts';

/** The run's natives, by key, over `run`. */
export function runNatives(run: Run): Natives {
  return { ...futureNatives(run), ...callNatives(run) };
}

/** `future` given as a value, the handle of one. */
const futureOf = (value: Value | undefined) => value as unknown as Future;

/** What futures, their callbacks and their settling stand on. */
function futureNatives(run: Run): Natives {
  /** `waited`'s callbacks whose resolvers may still decide, letting go of the others. */
  const live = (waited: Future): Waiting[] =>
    waited.callbacks.filter((waiting) => {
      const standing = run.callValue(waiting.standing, []);
      if (standing !== 0n) {
        waited.lost ||= standing === 1n;
        run.lifetimes.letGo(waiting.callback, waiting.standing);
      }
      return standing === 0n;
    });
  return {
    'prelude._settled(prelude.Future<T, K>)': ([given]) => futureOf(given).settled,
    'prelude._valueOf(prelude.Future<T, K>)': ([given]) => futureOf(given).value,
    'prelude._onSettled(prelude.Future<T, K>, fn(T) -> Unit, prelude.Array<Int>, fn() -> Int)': ([
      given,
      callback,
      rank,
      standing,
    ]) => {
      const waited = futureOf(given);
      run.lifetimes.hold(callback);
      run.lifetimes.hold(standing);
      const ranks = (rank as { readonly elements: readonly bigint[] }).elements;
      const added = { callback: callback ?? null, rank: ranks, standing: standing ?? null };
      waited.callbacks = [...live(waited), added];
      for (const awaited of [...waited.onAwaited]) {
        run.lifetimes.letGo(run.callValue(awaited, []) as Value);
      }
      return null;
    },
    'prelude._givenUp(prelude.Future<T, K>)': ([given]) => {
      const waited = futureOf(given);
      waited.callbacks = live(waited);
      return waited.lost && !waited.settled && waited.callbacks.length === 0;
    },
    'prelude._onAwaited(prelude.Future<T, K>, fn() -> Unit)': ([given, callback]) => {
      run.lifetimes.hold(callback);
      futureOf(given).onAwaited.push(callback ?? null);
      return null;
    },
    'prelude._settleAll(prelude.Array<prelude.Future<T, K>>, T)': ([given, value]) => {
      const futures = (given as { readonly elements: readonly Value[] }).elements.map(futureOf);
      for (const _ of futures) {
        run.lifetimes.hold(value);
      }
      run.settleTogether(futures.map((each) => [each, value ?? null] as const));
      return null;
    },
    'prelude._pendingFuture()': () => new Future(run.newId()) as unknown as Value,
    'prelude._settle(prelude.Future<T, K>, T)': ([given, value]) => {
      run.lifetimes.hold(value);
      run.settle(futureOf(given), value ?? null);
      return null;
    },
  };
}

/** What calls readied, parked and unparked stand on. */
function callNatives(run: Run): Natives {
  let made = 0;
  const call = (value: Value | undefined) => value as unknown as Execution;
  return {
    'prelude._later(fn() -> Unit)': ([callback]) => {
      run.lifetimes.hold(callback);
      run.queue.call(callback ?? null, []);
      return null;
    },
    'prelude._unpark(prelude._Call, Int)': ([given, position]) => {
      run.executions.unpark(call(given), position ?? null);
      return null;
    },
    'prelude._stayRunning(prelude._Call)': ([given]) => {
      run.queue.unready(call(given));
      return null;
    },
    'prelude._disposingWins(prelude._Call)': ([given]) => run.executions.disposingWins(call(given)),
    'prelude._idOf(prelude._Call)': ([given]) => BigInt(call(given).object),
    'prelude._made()': () => {
      made += 1;
      return BigInt(made);
    },
  };
}
