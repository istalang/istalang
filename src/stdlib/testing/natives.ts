/**
 * The `testing` module's natives (testing.ista, §18): function slots, waits on and reads of spawned
 * instances, and host handles, each a thin reading of the runtime's capabilities
 * (runtime/natives.ts), which own what they mean.
 *
 * An instance's state before its first commit, when it hasn't run yet, is `Running`, as it is for
 * one that is ready to.
 */

import {
  functionKey,
  type NativeKeys,
  type NativeParameter,
  parameterKey,
} from '../../definition/extern-key.ts';
import { namedType } from '../../definition/values/declared-values.ts';
import { instanceNameOf } from '../../definition/values/instance-handles.ts';
import { closureOf, type Value } from '../../definition/values/values.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import {
  type NativeContext,
  type Natives,
  Panic,
  type WithInstances,
  type WithTesting,
} from '../../runtime/natives.ts';
import { futureKey, knownTypeKey } from '../std-module.ts';
import { arrayOf, given, int, text } from '../values/arguments.ts';
import { declaredResult } from '../values/results.ts';

type Context = NativeContext & WithInstances & WithTesting;

export const testingNatives = (keys: NativeKeys): Natives<Context> => {
  const ofInstance = (name: string, ...rest: readonly NativeParameter[]) =>
    keys.of(name, knownTypeKey(wellKnown.instance, parameterKey('R')), ...rest);
  return {
    [keys.of('_bind', parameterKey('F'), parameterKey('F'))]: ([target, bound], context) =>
      BigInt(context.testing.bind(namedFunction(target), given(bound))),
    [keys.of('_unbind', 'Int')]: ([binding], context) => {
      context.testing.unbind(Number(int(binding)));
      return null;
    },
    [keys.of(
      'spawnCrashingEveryAwait',
      functionKey([], futureKey(parameterKey('T'), 'ista'), 'ista'),
    )]: ([entry], context) =>
      context.instances.spawn(given(entry), declaredResult(context), { crashEveryAwait: true }),
    [ofInstance('idle')]: ([handle], context) =>
      context.testing.watch(instanceNameOf(handle), { kind: 'idle' }),
    [ofInstance('reaches', 'String')]: ([handle, label], context) =>
      context.testing.watch(instanceNameOf(handle), { kind: 'waypoint', label: text(label) }),
    [ofInstance('waitingAt')]: ([handle], context) =>
      arrayOf(
        (context.testing.inspect(instanceNameOf(handle))?.waitingAt ?? []).map(
          ({ waypoint, location }) => waypoint ?? location,
        ),
      ),
    [ofInstance('_stateName')]: ([handle], context) =>
      context.testing.inspect(instanceNameOf(handle))?.state.kind ?? 'ready',
    [keys.of('handle')]: (_, context) =>
      context.testing.handle(namedType(context.signature.result)),
  };
};

/** The function a mock's target names; the checker allows only a named function there. */
function namedFunction(target: Value | undefined): number {
  const closure = closureOf(given(target));
  if (closure === undefined || closure.captures.length > 0) {
    throw new Panic("A mock's target must name a function (§18).");
  }
  return closure.function;
}
