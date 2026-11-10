/**
 * The `runtime` module's natives (runtime.ista): the instance's name and version, read from the
 * call's context; `commit()`, a future that is already resolved, so awaiting it commits without
 * waiting (§5); and the spawn behind `isolate`, an instance a panic terminates at once (§9).
 */

import { functionKey, parameterKey } from '../../definition/extern-key.ts';
import type { NativeContext, Natives, WithFutures, WithInstances } from '../../runtime/natives.ts';
import { futureKey, type NativeKeys } from '../std-module.ts';
import { given } from '../values/arguments.ts';
import { declaredResult } from '../values/results.ts';

export const runtimeNatives = (
  keys: NativeKeys,
): Natives<NativeContext & WithFutures & WithInstances> => ({
  [keys.of('id')]: (_arguments, context) => context.instance,
  [keys.of('version')]: (_arguments, context) => context.version,
  [keys.of('commit')]: (_arguments, context) => context.futures.resolved(null),
  [keys.of('_isolated', functionKey([], futureKey(parameterKey('T'), 'ista')))]: (
    [entry],
    context,
  ) => context.instances.spawn(given(entry), declaredResult(context), { terminatesOnPanic: true }),
});
