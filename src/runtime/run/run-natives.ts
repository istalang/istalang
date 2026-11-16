/**
 * The natives of the run's own primitives (ir-first design, decision 6): what the prelude's futures,
 * resolvers and waits, written in Istalang, stand on. Every backend implements these; nothing else
 * of the run is reachable from Istalang.
 *
 * - A future keeps the callbacks waiting on it with their rank (prelude.ista `Resolver`), and the
 *   run calls them in rank order as it settles (`Run.settle`).
 * - `_later` readies a call of its own, as a `Resolver.of` callback and an `onCancel` run (§8).
 * - `_unpark` readies a parked call to resume with its wait's decided position.
 */

import type { Native, Natives } from '../natives.ts';
import type { Value } from '../../definition/values/values.ts';
import { type Execution, Future } from './objects.ts';
import type { Run } from './run.ts';

/** The run's natives, by key, over `run`. */
export function runNatives(run: Run): Natives {
  let made = 0;
  const future = (value: Value | undefined) => value as unknown as Future;
  const natives: Record<string, Native> = {
    'prelude._settled(prelude.Future<T, K>)': ([given]) => future(given).settled,
    'prelude._valueOf(prelude.Future<T, K>)': ([given]) => future(given).value,
    'prelude._onSettled(prelude.Future<T, K>, fn(T) -> Unit, prelude.Array<Int>)': ([
      given,
      callback,
      rank,
    ]) => {
      run.lifetimes.hold(callback);
      const ranks = (rank as { readonly elements: readonly bigint[] }).elements;
      future(given).callbacks.push({ callback: callback ?? null, rank: ranks });
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
