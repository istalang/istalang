/**
 * The natives of the prelude's futures, resolvers and waits: each one call of a run primitive
 * (runtime/run/run-primitives.ts), which the run gives its natives as the `run` capability.
 */

import { functionKey, type NativeKeys, parameterKey } from '../../definition/extern-key.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import type { NativeContext, Natives, WithRun } from '../../runtime/natives.ts';
import { knownTypeKey } from '../std-module.ts';
import { arrayOf, given } from '../values/arguments.ts';

const value = parameterKey('T');
const future = knownTypeKey(wellKnown.future, value, parameterKey('K'));
const call = knownTypeKey(wellKnown.call);
const action = functionKey([], 'Unit');

type RunNatives = Natives<NativeContext & WithRun>;

export const runNatives = (keys: NativeKeys): RunNatives => ({
  ...futureNatives(keys),
  ...callNatives(keys),
});

/** What futures, what waits on them, their settling and their widening stand on. */
const futureNatives = (keys: NativeKeys): RunNatives => {
  const waitersType = keys.type('_Waiters', value, parameterKey('K'));
  return {
    [keys.of('_settled', future)]: ([settled], { run }) => run.settled(given(settled)),
    [keys.of('_valueOf', future)]: ([settled], { run }) => run.valueOf(given(settled)),
    [keys.of('_waitersOf', future)]: ([waited], { run }) => {
      const waiters = run.waitersOf(given(waited));
      return arrayOf(waiters === undefined ? [] : [waiters]);
    },
    [keys.of('_wait', future, waitersType, functionKey([value], 'Unit'), action)]: (
      [waited, kept, arrived, disposed],
      { run },
    ) => {
      run.wait(given(waited), {
        waiters: given(kept),
        arrived: given(arrived),
        disposed: given(disposed),
      });
      return null;
    },
    [keys.of('_settleAll', knownTypeKey(wellKnown.array, future), value)]: (
      [futures, settled],
      { run },
    ) => {
      run.settleAll(given(futures), given(settled));
      return null;
    },
    [keys.of('_pendingFuture')]: (_, { run }) => run.pendingFuture(),
    [keys.of('_settle', future, value)]: ([settling, settled], { run }) => {
      run.settle(given(settling), given(settled));
      return null;
    },
    [keys.of('_converted', future, functionKey([value], parameterKey('U')))]: (
      [widened, converter],
      { run },
    ) => run.following(given(widened), given(converter)),
  };
};

/** What calls readied, parked and unparked stand on. */
const callNatives = (keys: NativeKeys): RunNatives => ({
  [keys.of('_later', action)]: ([callback], { run }) => {
    run.later(given(callback));
    return null;
  },
  [keys.of('_unpark', call, 'Int')]: ([parked, position], { run }) => {
    run.unpark(given(parked), given(position));
    return null;
  },
  [keys.of('_awaiting', call, action)]: ([waiting, holding], { run }) => {
    run.awaiting(given(waiting), given(holding));
    return null;
  },
  [keys.of('_waitEnded', call)]: ([waiting], { run }) => {
    run.waitEnded(given(waiting));
    return null;
  },
  [keys.of('_stayRunning', call)]: ([running], { run }) => {
    run.stayRunning(given(running));
    return null;
  },
  [keys.of('_disposingWins', call)]: ([disposed], { run }) => run.disposingWins(given(disposed)),
});
