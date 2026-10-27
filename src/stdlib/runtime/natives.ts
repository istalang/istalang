/**
 * The `runtime` module's natives (runtime.ista): the instance's name and version, read from the
 * call's context, and `commit()`, a future that is already resolved, so awaiting it commits
 * without waiting (§5).
 */

import type { NativeContext, Natives, WithFutures } from '../../runtime/natives.ts';
import type { NativeKeys } from '../std-module.ts';

export const runtimeNatives = (keys: NativeKeys): Natives<NativeContext & WithFutures> => ({
  [keys.of('id')]: (_arguments, context) => context.instance,
  [keys.of('version')]: (_arguments, context) => context.version,
  [keys.of('commit')]: (_arguments, context) => context.futures.resolved(null),
});
