/**
 * The `runtime` module's natives (runtime.ista): the instance's name and version, read from the
 * call's context; `commit()`, a future that is already resolved, so awaiting it commits without
 * waiting (§5); the spawn behind `isolate`, an instance a panic terminates at once (§9); and the
 * host's store, the runtimes over it and calls into their contexts, a live run's
 * (runtime/scheduler/run-contexts.ts).
 */

import { functionKey, namedKey, parameterKey } from '../../definition/extern-key.ts';
import { fieldValueOf } from '../../definition/values/declared-values.ts';
import {
  type NativeContext,
  type Natives,
  Panic,
  type WithContexts,
  type WithFutures,
  type WithInstances,
} from '../../runtime/natives.ts';
import { futureKey, type NativeKeys } from '../std-module.ts';
import { given, text } from '../values/arguments.ts';
import { declaredResult, resultTypeArgument } from '../values/results.ts';

export const runtimeNatives = (
  keys: NativeKeys,
): Natives<NativeContext & WithFutures & WithInstances & WithContexts> => ({
  [keys.of('id')]: (_arguments, context) => context.instance,
  [keys.of('version')]: (_arguments, context) => context.version,
  [keys.of('commit')]: (_arguments, context) => context.futures.resolved(null),
  [keys.of('_isolated', functionKey([], futureKey(parameterKey('T'), 'ista'), 'ista'))]: (
    [entry],
    context,
  ) => context.instances.spawn(given(entry), declaredResult(context), { terminatesOnPanic: true }),
  [keys.of('_raise', namedKey('prelude.Error'))]: ([error], context) => {
    const field = (name: string) => text(fieldValueOf(context.types, error, name));
    throw new Panic(field('message'), { trace: field('trace') });
  },
  [keys.of('hostStore')]: (_arguments, context) =>
    context.contexts.hostStore(declaredResult(context)),
  [keys.ofStatic('Runtime', 'open', keys.type('Store'))]: ([store], context) =>
    context.futures.resolved(context.contexts.open(given(store), resultTypeArgument(context, 0))),
  [keys.of(
    '_call',
    keys.type('Runtime'),
    'String',
    functionKey([], futureKey(parameterKey('R'), 'ista'), 'ista'),
  )]: ([runtime, key, entry], context) =>
    context.contexts.call(given(runtime), text(key), given(entry), resultTypeArgument(context, 0)),
});
