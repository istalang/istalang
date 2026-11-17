/**
 * The run's own primitives (ir-first design, decision 6): what the prelude's futures, resolvers and
 * waits, written in Istalang, stand on, given to its natives as a capability (runtime/natives.ts
 * `WithRun`). Every backend implements these; the std's other natives reach the run only through
 * the other capabilities they are given (capabilities.ts).
 *
 * - A pending future keeps what waits on it as the prelude keeps it (`waiting`, prelude.ista
 *   `_Waiters`): the run calls it as the future settles (`Run.settle`, §6), or, as code its disposal
 *   runs, as it is disposed first. Which resolvers wait, in what order, and which can still decide
 *   are the prelude's.
 * - A future widened is followed by one of its own (`following`, following.ts), which settles as
 *   it does with its value converted, so a widened call's future is the call's own and the future
 *   it follows stays as it is for whatever else reaches it.
 * - `later` readies a call of its own, as a `Resolver.of` callback and an `onCancel` run (§8).
 * - `unpark` readies a parked call to resume with its wait's decided position; a wait decided
 *   before its call parks readies it all the same, as awaiting still yields (§6), unless the call
 *   goes on without parking (`stayRunning`), as a `select` that doesn't wait does.
 * - A call holds what its wait's cases are registered on (`awaiting`) until the wait is let go of
 *   (`waitEnded`): the run holds it, since a future may reach whatever its callbacks do, so no
 *   value of the program's could hold it without a cycle the analysis of lifetimes would refuse.
 */

import type { Value } from '../../definition/values/values.ts';
import { convertedFollowing, follow } from './following.ts';
import type { Execution } from './objects/execution.ts';
import { Future, type Waiting, waitingValues } from './objects/future.ts';
import type { Run } from './run.ts';

/** The run's primitives; a future and a call are given and taken as their handles. */
export interface RunPrimitives {
  readonly settled: (future: Value) => boolean;
  readonly valueOf: (future: Value) => Value;
  /** The prelude's record of what waits on `future`, once something came to; none before. */
  readonly waitersOf: (future: Value) => Value | undefined;
  readonly wait: (future: Value, waiting: Waiting) => void;
  /** Settles each of the `Array` `futures` with `value`, together. */
  readonly settleAll: (futures: Value, value: Value) => void;
  readonly pendingFuture: () => Value;
  readonly settle: (future: Value, value: Value) => void;
  /** A future following `future`, settling with what `converter` makes of its value. */
  readonly following: (future: Value, converter: Value) => Value;
  readonly later: (callback: Value) => void;
  readonly unpark: (call: Value, position: Value) => void;
  readonly awaiting: (call: Value, holding: Value) => void;
  readonly waitEnded: (call: Value) => void;
  readonly stayRunning: (call: Value) => void;
  readonly disposingWins: (call: Value) => boolean;
}

/** `future` given as a value, the handle of one. */
const futureOf = (value: Value) => value as unknown as Future;

/** `call` given as a value, the handle of one. */
const callOf = (value: Value) => value as unknown as Execution;

/** The primitives of `run`. */
export function runPrimitivesOf(run: Run): RunPrimitives {
  return { ...futurePrimitives(run), ...conversionPrimitives(run), ...callPrimitives(run) };
}

/** What futures, what waits on them and their settling stand on. */
function futurePrimitives(run: Run) {
  return {
    settled: (given: Value) => futureOf(given).settled,
    valueOf: (given: Value) => futureOf(given).value,
    waitersOf: (given: Value) => futureOf(given).waiting?.waiters,
    wait: (given: Value, waiting: Waiting) => {
      for (const value of waitingValues(waiting)) {
        run.lifetimes.hold(value);
      }
      futureOf(given).waiting = waiting;
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
    following: (given: Value, converter: Value) => {
      const followed = futureOf(given);
      const follower = new Future(run.newId());
      run.lifetimes.hold(converter);
      if (followed.settled) {
        const call = (closure: Value, value: Value) => run.callValue(closure, [value]);
        run.settle(follower, convertedFollowing(call, run.lifetimes, converter, followed.value));
      } else {
        run.lifetimes.hold(given);
        follow(follower, { future: followed, converter });
      }
      return follower as unknown as Value;
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
  };
}
