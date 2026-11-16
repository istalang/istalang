/**
 * The `runtime` module's natives (runtime.ista): the instance's name and version, read from the
 * call's context; `commit()`, a future that is already resolved, so awaiting it commits without
 * waiting (§5); the spawn behind `isolate`, an instance a panic terminates at once (§9); and the
 * host's store, the runtimes over it and calls into their contexts, a live run's
 * (runtime/run/capabilities.ts).
 */

import { functionKey, namedKey, parameterKey } from '../../definition/extern-key.ts';
import { fieldValueOf } from '../../definition/values/declared-values.ts';
import type { CallMaker } from '../../runtime/natives.ts';
import {
  type Native,
  type NativeContext,
  type Natives,
  Panic,
  type WithContexts,
  type WithFutures,
  type WithInstances,
} from '../../runtime/natives.ts';
import { futureKey, type NativeKeys } from '../std-module.ts';
import { arrayOf, given, int, text } from '../values/arguments.ts';
import { declaredResult, resultTypeArgument } from '../values/results.ts';

export const runtimeNatives = (
  keys: NativeKeys,
): Natives<NativeContext & WithFutures & WithInstances & WithContexts> => ({
  [keys.of('id')]: (_arguments, context) => context.instance,
  [keys.of('version')]: (_arguments, context) => context.version,
  [keys.of('commit')]: (_arguments, context) => context.futures.resolved(null),
  [keys.of('_raise', namedKey('prelude.Error'))]: ([error], context) => {
    const field = (name: string) => text(fieldValueOf(context.types, error, name));
    throw new Panic(field('message'), { trace: field('trace') });
  },
  [keys.of('_isolated', functionKey([], futureKey(parameterKey('T'), 'ista'), 'ista'))]: (
    [entry],
    context,
  ) => context.instances.spawn(given(entry), declaredResult(context), { terminatesOnPanic: true }),
  [keys.of('hostStore')]: (_arguments, context) =>
    context.contexts.hostStore(declaredResult(context)),
  [keys.ofStatic('_Runtime', 'open', keys.type('Store'))]: ([store], context) =>
    context.futures.resolved(context.contexts.open(given(store), resultTypeArgument(context, 0))),
  [contextCallKey(keys, '_called')]: contextCall('program'),
  [contextCallKey(keys, '_jobCalled')]: contextCall('jobs'),
  [keys.of('_served', keys.type('_Runtime'), 'Int')]: ([runtime, known], context) =>
    context.contexts.served(given(runtime), Number(int(known))),
  [keys.of('_jobServer')]: (_arguments, context) =>
    arrayOf([context.contexts.jobServer()].filter((server) => server !== undefined)),
});

/** The key of `name`, a call into a context of a runtime: the program's, or its job loop's. */
function contextCallKey(keys: NativeKeys, name: string): string {
  const called = functionKey([], futureKey(parameterKey('R'), 'ista'), 'ista');
  return keys.of(name, keys.type('_Runtime'), 'String', called);
}

/** The native of a call into a context that `maker` makes. */
function contextCall(maker: CallMaker): Native<NativeContext & WithContexts> {
  return ([runtime, key, entry], context) =>
    context.contexts.call(given(runtime), { key: text(key), call: given(entry), maker });
}
