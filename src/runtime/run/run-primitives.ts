/**
 * The run's own primitives (ir-first design, decision 6): what the prelude's futures, resolvers and
 * waits, written in Istalang, stand on, given to its natives as a capability (runtime/natives.ts
 * `WithRun`). Every backend implements these; nothing else of the run is reachable from Istalang.
 *
 * - A future keeps the callbacks waiting on it with their rank (prelude.ista `Resolver`), and the
 *   run calls them in rank order as it settles (`Run.settle`). Each comes with what says what its
 *   resolver stands for: one that can't decide any more is dropped as another comes or is asked
 *   about, and a future one of those lost on, with nothing waiting on it, is given up on, which a
 *   slot passes over (§6, §8). A withdrawn one, a `select`'s that didn't wait, gives up on nothing.
 * - A future nothing else holds, refers to weakly or waits on, widened, converts its value in
 *   place, as it settles or at once (`convertedInPlace`, settling.ts `converted`), so a widened
 *   call's future is the call's own.
 * - `later` readies a call of its own, as a `Resolver.of` callback and an `onCancel` run (§8).
 * - `unpark` readies a parked call to resume with its wait's decided position; a wait decided
 *   before its call parks readies it all the same, as awaiting still yields (§6), unless the call
 *   goes on without parking (`stayRunning`), as a `select` that doesn't wait does.
 * - A call holds what its wait's cases are registered on (`awaiting`) until the wait is let go of
 *   (`waitEnded`): the run holds it, since a future may reach whatever its callbacks do, so no
 *   value of the program's could hold it without a cycle the analysis of lifetimes would refuse.
 */

import type { Value } from '../../definition/values/values.ts';
import type { Execution } from './objects/execution.ts';
import { closuresOf, Future, type Waiting } from './objects/future.ts';
import type { Run } from './run.ts';
import { converted } from './settling.ts';

/** A callback registered on a future, with what decides it (prelude.ista `_onSettled`). */
interface Registered {
  readonly callback: Value;
  /** The `Array<Int>` of its rank. */
  readonly rank: Value;
  readonly standing: Value;
  readonly cancelled: Value;
}

/** The run's primitives; a future and a call are given and taken as their handles. */
export interface RunPrimitives {
  readonly settled: (future: Value) => boolean;
  readonly valueOf: (future: Value) => Value;
  readonly onSettled: (future: Value, registered: Registered) => void;
  /** Whether `future` was given up on: a case waiting on it lost and nothing waits any more. */
  readonly givenUp: (future: Value) => boolean;
  readonly onAwaited: (future: Value, callback: Value) => void;
  /** Settles each of the `Array` `futures` with `value`, together. */
  readonly settleAll: (futures: Value, value: Value) => void;
  readonly pendingFuture: () => Value;
  readonly settle: (future: Value, value: Value) => void;
  /** Whether nothing but its caller holds `future`, refers to it weakly or waits on it. */
  readonly unshared: (future: Value) => boolean;
  /** `future`, which nothing but its caller reaches, giving what `converter` makes of its value. */
  readonly convertedInPlace: (future: Value, converter: Value) => Value;
  readonly later: (callback: Value) => void;
  readonly unpark: (call: Value, position: Value) => void;
  readonly awaiting: (call: Value, holding: Value) => void;
  readonly waitEnded: (call: Value) => void;
  readonly stayRunning: (call: Value) => void;
  readonly disposingWins: (call: Value) => boolean;
  readonly idOf: (call: Value) => bigint;
  /** The next of the instance's serial, persisted with it. */
  readonly made: () => bigint;
}

/** `future` given as a value, the handle of one. */
const futureOf = (value: Value) => value as unknown as Future;

/** `call` given as a value, the handle of one. */
const callOf = (value: Value) => value as unknown as Execution;

/** The primitives of `run`. */
export function runPrimitivesOf(run: Run): RunPrimitives {
  return { ...futurePrimitives(run), ...conversionPrimitives(run), ...callPrimitives(run) };
}

/** What futures, their callbacks and their settling stand on. */
function futurePrimitives(run: Run) {
  /** `waited`'s callbacks whose resolvers may still decide, letting go of the others. */
  const live = (waited: Future): Waiting[] =>
    waited.callbacks.filter((waiting) => {
      const standing = run.callValue(waiting.standing, []);
      if (standing !== 0n) {
        waited.lost ||= standing === 1n;
        run.lifetimes.letGo(...closuresOf(waiting));
      }
      return standing === 0n;
    });
  return {
    settled: (given: Value) => futureOf(given).settled,
    valueOf: (given: Value) => futureOf(given).value,
    onSettled: (given: Value, { callback, rank, standing, cancelled }: Registered) => {
      const waited = futureOf(given);
      const ranks = (rank as { readonly elements: readonly bigint[] }).elements;
      const added: Waiting = { callback, rank: ranks, standing, cancelled };
      for (const closure of closuresOf(added)) {
        run.lifetimes.hold(closure);
      }
      waited.callbacks = [...live(waited), added];
      for (const awaited of [...waited.onAwaited]) {
        run.lifetimes.letGo(run.callValue(awaited, []) as Value);
      }
    },
    givenUp: (given: Value) => {
      const waited = futureOf(given);
      waited.callbacks = live(waited);
      return waited.lost && !waited.settled && waited.callbacks.length === 0;
    },
    onAwaited: (given: Value, callback: Value) => {
      run.lifetimes.hold(callback);
      futureOf(given).onAwaited.push(callback);
    },
    settleAll: (given: Value, value: Value) => {
      const futures = (given as { readonly elements: readonly Value[] }).elements.map(futureOf);
      for (const _ of futures) {
        run.lifetimes.hold(value);
      }
      run.settleTogether(futures.map((each) => [each, value] as const));
    },
    pendingFuture: () => new Future(run.newId()) as unknown as Value,
    settle: (given: Value, value: Value) => {
      run.lifetimes.hold(value);
      run.settle(futureOf(given), value);
    },
  };
}

/** What a future widened stands on (prelude.ista `_converted`). */
function conversionPrimitives(run: Run) {
  return {
    unshared: (given: Value) => {
      const future = futureOf(given);
      const { count, callbacks, listeners } = future;
      const waitedOn = callbacks.length > 0 || listeners.length > 0;
      return count <= 1 && !waitedOn && !run.weakReferences.made(future);
    },
    convertedInPlace: (given: Value, converter: Value) => {
      const future = futureOf(given);
      run.lifetimes.hold(converter);
      if (future.settled) {
        const call = (closure: Value, value: Value) => run.callValue(closure, [value]);
        future.value = converted(call, run.lifetimes, future.value, converter);
      } else {
        future.converters.push(converter);
      }
      return given;
    },
  };
}

/** What calls readied, parked and unparked stand on. */
function callPrimitives(run: Run) {
  return {
    later: (callback: Value) => {
      run.lifetimes.hold(callback);
      run.queue.call(callback, []);
    },
    unpark: (given: Value, position: Value) => run.executions.unpark(callOf(given), position),
    awaiting: (given: Value, holding: Value) => {
      run.lifetimes.hold(holding);
      callOf(given).awaiting.push(holding);
    },
    waitEnded: (given: Value) => run.lifetimes.letGo(...callOf(given).awaiting.splice(0)),
    stayRunning: (given: Value) => run.queue.unready(callOf(given)),
    disposingWins: (given: Value) => run.executions.disposingWins(callOf(given)),
    idOf: (given: Value) => BigInt(callOf(given).object),
    made: () => BigInt(run.newId()),
  };
}
