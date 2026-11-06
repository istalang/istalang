/**
 * The `testing` module's natives (testing.ista, §10): mocks, waits on and reads of spawned
 * instances, and host handles, each a thin reading of the runtime's capabilities
 * (runtime/natives.ts), which own what they mean.
 *
 * An instance's state before its first commit, when it hasn't run yet, is `Running`, as it is for
 * one that is ready to.
 */

import { functionKey, type NativeParameter, parameterKey } from '../../definition/extern-key.ts';
import { instanceNameOf } from '../../definition/values/instance-handles.ts';
import { closureOf, type Value } from '../../definition/values/values.ts';
import { wellKnown } from '../../language/well-known/index.ts';
import type { InstanceState } from '../../runtime/instance-state.ts';
import {
  type NativeContext,
  type Natives,
  Panic,
  type WithInstances,
  type WithTesting,
} from '../../runtime/natives.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { arrayOf, given, text } from '../values/arguments.ts';
import { declaredResult, resultVariant } from '../values/results.ts';

type Context = NativeContext & WithInstances & WithTesting;

/** The variant of `InstanceState` (testing.ista) each state a test can see reads as. */
const stateVariants: Record<InstanceState['kind'], string> = {
  ready: 'Running',
  waiting: 'Waiting',
  panicked: 'Panicked',
  finished: 'Finished',
  terminated: 'Terminated',
};

export const testingNatives = (keys: NativeKeys): Natives<Context> => {
  const ofInstance = (name: string, ...rest: readonly NativeParameter[]) =>
    keys.of(name, knownTypeKey(wellKnown.instance, parameterKey('R')), ...rest);
  return {
    [keys.of('_mock', parameterKey('F'), parameterKey('F'))]: ([target, replacement], context) =>
      context.testing.mock(namedFunction(target), given(replacement)),
    [keys.of('_calls', keys.type('Mock', parameterKey('F')))]: ([mock], context) =>
      arrayOf(context.testing.calls(given(mock))),
    [keys.of('spawnCrashingEveryAwait', functionKey(true, [], parameterKey('T')))]: (
      [entry],
      context,
    ) => context.instances.spawn(given(entry), declaredResult(context), { crashEveryAwait: true }),
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
    [ofInstance('state')]: ([handle], context) => {
      const state = context.testing.inspect(instanceNameOf(handle))?.state.kind ?? 'ready';
      return resultVariant(context, stateVariants[state], {});
    },
    [keys.of('handle')]: (_, context) =>
      context.testing.handle(
        context.typeArguments[0] ?? unreachable(`${context.name} names no host type.`),
      ),
  };
};

/** The function a mock's target names; the checker allows only a named function there. */
function namedFunction(target: Value | undefined): number {
  const closure = closureOf(given(target));
  if (closure === undefined || closure.captures.length > 0) {
    throw new Panic("A mock's target must name a function (§10).");
  }
  return closure.function;
}
