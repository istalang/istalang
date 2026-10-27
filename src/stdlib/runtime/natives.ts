/**
 * The `runtime` module's natives (runtime.ista): the instance's name and version, read from the
 * call's context; `commit()`, a future that is already resolved, so awaiting it commits without
 * waiting (§5); and the spawn behind `isolate`, an instance a panic terminates at once (§9).
 */

import { parameterKey } from '../../definition/extern-key.ts';
import type { NativeContext, Natives, WithFutures, WithInstances } from '../../runtime/natives.ts';
import { given, resultExtern } from '../native-values.ts';
import type { NativeKeys } from '../std-module.ts';

export const runtimeNatives = (
  keys: NativeKeys,
): Natives<NativeContext & WithFutures & WithInstances> => ({
  [keys.of('id')]: (_arguments, context) => context.instance,
  [keys.of('version')]: (_arguments, context) => context.version,
  [keys.of('commit')]: (_arguments, context) => context.futures.resolved(null),
  [keys.of('_isolated', parameterKey('F'))]: ([entry], context) =>
    resultExtern(context, context.instances.spawn(given(entry), { terminatesOnPanic: true })),
});
