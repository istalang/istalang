/**
 * The `testing` module's natives (testing.ista, §10): mocks, started instances and host handles,
 * each a thin reading of the runtime's testing capability (runtime/natives.ts), which owns what
 * they mean.
 *
 * A `Started<R>` is a host value of the extern type `Started`, its payload the name the started
 * instance has, so a handle compares by the instance it names. An instance's state before its
 * first commit, when it hasn't run yet, is `Running`, as it is for one that is ready to.
 */

import { type NativeParameter, parameterKey } from '../../definition/extern-key.ts';
import { isComposite, type Value } from '../../definition/values.ts';
import type { InstanceState } from '../../runtime/instance-state.ts';
import {
  type NativeContext,
  type Natives,
  Panic,
  type WithTesting,
} from '../../runtime/natives.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { arrayOf, given, resultVariant, text } from '../native-values.ts';
import type { NativeKeys } from '../std-module.ts';

type Context = NativeContext & WithTesting;

/** The variant of `InstanceState` (testing.ista) each state a test can see reads as. */
const stateVariants: Record<InstanceState['kind'], string> = {
  ready: 'Running',
  waiting: 'Waiting',
  panicked: 'Panicked',
  finished: 'Finished',
  terminated: 'Finished',
};

export const testingNatives = (keys: NativeKeys): Natives<Context> => {
  const started = keys.type('Started', parameterKey('R'));
  const ofStarted = (name: string, ...rest: readonly NativeParameter[]) =>
    keys.of(name, started, ...rest);
  const start =
    (crashEveryAwait: boolean) =>
    ([entry, values]: readonly Value[], context: Context): Value => ({
      kind: 'extern',
      type: context.resultType ?? unreachable(`${context.name} starts no Started.`),
      payload: context.testing.start(given(entry), tupleElements(values), crashEveryAwait),
    });
  const startKey = (name: string) => keys.of(name, parameterKey('F'), parameterKey('A'));
  return {
    [keys.of('_mock', parameterKey('F'), parameterKey('F'))]: ([target, replacement], context) =>
      context.testing.mock(namedFunction(target), given(replacement)),
    [keys.of('_calls', keys.type('Mock', parameterKey('F')))]: ([mock], context) =>
      arrayOf(context.testing.calls(given(mock))),
    [startKey('_start')]: start(false),
    [startKey('_startCrashingEveryAwait')]: start(true),
    [ofStarted('idle')]: ([handle], context) =>
      context.testing.watch(instanceOf(handle), { kind: 'idle' }),
    [ofStarted('reaches', 'string')]: ([handle, label], context) =>
      context.testing.watch(instanceOf(handle), { kind: 'waypoint', label: text(label) }),
    [ofStarted('result')]: ([handle], context) =>
      context.testing.watch(instanceOf(handle), { kind: 'finished' }),
    [ofStarted('_panicked')]: ([handle], context) =>
      context.testing.watch(instanceOf(handle), { kind: 'panicked' }),
    [ofStarted('waitingAt')]: ([handle], context) =>
      arrayOf(
        (context.testing.inspect(instanceOf(handle))?.waitingAt ?? []).map(
          ({ waypoint, location }) => waypoint ?? location,
        ),
      ),
    [ofStarted('state')]: ([handle], context) => {
      const state = context.testing.inspect(instanceOf(handle))?.state.kind ?? 'ready';
      return resultVariant(context, stateVariants[state], []);
    },
    [keys.of('handle')]: (_, context) =>
      context.testing.handle(
        context.typeArguments[0] ?? unreachable(`${context.name} names no host type.`),
      ),
  };
};

/** The function a mock's target names; the checker allows only a named function there. */
function namedFunction(target: Value | undefined): number {
  const value = given(target);
  if (!isComposite(value) || value.kind !== 'closure' || value.captures.length > 0) {
    throw new Panic("A mock's target must name a function (§10).");
  }
  return value.function;
}

/** The instance a `Started` handle names. */
function instanceOf(handle: Value | undefined): string {
  const value = given(handle);
  if (!isComposite(value) || value.kind !== 'extern' || typeof value.payload !== 'string') {
    unreachable('A Started handle holds no instance name.');
  }
  return value.payload;
}

/** The arguments a started function is given: a tuple of them, or `()` for none. */
function tupleElements(values: Value | undefined): readonly Value[] {
  const tuple = given(values);
  if (tuple === null) {
    return [];
  }
  if (!isComposite(tuple) || tuple.kind !== 'tuple') {
    unreachable("A started function's arguments aren't a tuple.");
  }
  return tuple.elements;
}
