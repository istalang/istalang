/**
 * The natives of the run's own primitives (ir-first design, decision 6): what the prelude's futures,
 * resolvers and waits, written in Istalang, stand on. Every backend implements these; nothing else
 * of the run is reachable from Istalang.
 *
 * - A future keeps the callbacks waiting on it with their rank (prelude.ista `Resolver`), and the
 *   run calls them in rank order as it settles (`Run.settle`). Each comes with what says whether
 *   its resolver may still decide anything: one that can't is dropped as another comes, and a
 *   future awaited only by such ones is given up on, which a slot passes over (§6, §8).
 * - `_later` readies a call of its own, as a `Resolver.of` callback and an `onCancel` run (§8).
 * - `_unpark` readies a parked call to resume with its wait's decided position.
 */

import type { Native, Natives } from '../natives.ts';
import type { Value } from '../../definition/values/values.ts';
import { type Execution, Future, type Waiting } from './objects.ts';
import type { Run } from './run.ts';

/** The run's natives, by key, over `run`. */
export function runNatives(run: Run): Natives {
  let made = 0;
  const future = (value: Value | undefined) => value as unknown as Future;
  /** `waited`'s callbacks whose resolvers may still decide, letting go of the others. */
  const live = (waited: Future): Waiting[] =>
    waited.callbacks.filter((waiting) => {
      const pending = run.callValue(waiting.pending, []) === true;
      if (!pending) {
        run.lifetimes.letGo(waiting.callback, waiting.pending);
      }
      return pending;
    });
  const natives: Record<string, Native> = {
    'prelude._settled(prelude.Future<T, K>)': ([given]) => future(given).settled,
    'prelude._valueOf(prelude.Future<T, K>)': ([given]) => future(given).value,
    'prelude._onSettled(prelude.Future<T, K>, fn(T) -> Unit, prelude.Array<Int>, fn() -> Bool)': ([
      given,
      callback,
      rank,
      pending,
    ]) => {
      const waited = future(given);
      run.lifetimes.hold(callback);
      run.lifetimes.hold(pending);
      const ranks = (rank as { readonly elements: readonly bigint[] }).elements;
      waited.awaited = true;
      waited.callbacks = [...live(waited), { callback: callback ?? null, rank: ranks, pending: pending ?? null }];
      for (const awaited of [...waited.onAwaited]) {
        run.lifetimes.letGo(run.callValue(awaited, []) as Value);
      }
      return null;
    },
    'prelude._givenUp(prelude.Future<T, K>)': ([given]) => {
      const waited = future(given);
      waited.callbacks = live(waited);
      return waited.awaited && !waited.settled && waited.callbacks.length === 0;
    },
    'prelude._onAwaited(prelude.Future<T, K>, fn() -> Unit)': ([given, callback]) => {
      run.lifetimes.hold(callback);
      future(given).onAwaited.push(callback ?? null);
      return null;
    },
    'prelude._settleAll(prelude.Array<prelude.Future<T, K>>, T)': ([given, value]) => {
      const futures = (given as { readonly elements: readonly Value[] }).elements.map(future);
      for (const _ of futures) {
        run.lifetimes.hold(value);
      }
      run.settleTogether(futures.map((each) => [each, value ?? null] as const));
      return null;
    },
    'prelude._pendingFuture()': () => new Future(run.newId()) as unknown as Value,
    'prelude._settle(prelude.Future<T, K>, T)': ([given, value]) => {
      run.lifetimes.hold(value);
      run.settle(future(given), value ?? null);
      return null;
    },
    'prelude._later(fn() -> Unit)': ([callback]) => {
      run.lifetimes.hold(callback);
      run.enqueue(callback ?? null, []);
      return null;
    },
    'prelude._unpark(prelude._Call, Int)': ([call, position]) => {
      run.unpark(call as unknown as Execution, position ?? null);
      return null;
    },
    'prelude._idOf(prelude._Call)': ([call]) => BigInt((call as unknown as Execution).object),
    'prelude._made()': () => {
      made += 1;
      return BigInt(made);
    },
  };
  return natives;
}
