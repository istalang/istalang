/**
 * The natives of the prelude's futures, resolvers and waits: each one call of a run primitive
 * (runtime/run/run-primitives.ts), which the run gives its natives as the `run` capability.
 */

import { functionKey, type NativeKeys, parameterKey } from '../../definition/extern-key.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import type { NativeContext, Natives, WithRun } from '../../runtime/natives.ts';
import { knownTypeKey } from '../std-module.ts';
import { given } from '../values/arguments.ts';

const value = parameterKey('T');
const future = knownTypeKey(wellKnown.future, value, parameterKey('K'));
const call = knownTypeKey(wellKnown.call);
const action = functionKey([], 'Unit');

type RunNatives = Natives<NativeContext & WithRun>;

export const runNatives = (keys: NativeKeys): RunNatives => ({
  ...futureNatives(keys),
  ...callNatives(keys),
});

/** What futures, their callbacks, their settling and their widening stand on. */
const futureNatives = (keys: NativeKeys): RunNatives => ({
  [keys.of('_settled', future)]: ([settled], { run }) => run.settled(given(settled)),
  [keys.of('_valueOf', future)]: ([settled], { run }) => run.valueOf(given(settled)),
  [keys.of(
    '_onSettled',
    future,
    functionKey([value], 'Unit'),
    knownTypeKey(wellKnown.array, 'Int'),
    functionKey([], 'Int'),
    action,
  )]: ([waited, callback, rank, standing, cancelled], { run }) => {
    run.onSettled(given(waited), {
      callback: given(callback),
      rank: given(rank),
      standing: given(standing),
      cancelled: given(cancelled),
    });
    return null;
  },
  [keys.of('_givenUp', future)]: ([waited], { run }) => run.givenUp(given(waited)),
  [keys.of('_onAwaited', future, action)]: ([waited, callback], { run }) => {
    run.onAwaited(given(waited), given(callback));
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
});

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
  [keys.of('_idOf', call)]: ([identified], { run }) => run.idOf(given(identified)),
  [keys.of('_made')]: (_, { run }) => run.made(),
});
