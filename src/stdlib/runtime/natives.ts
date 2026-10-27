/**
 * The `runtime` module's natives (runtime.ista). `commit()` is a future that is already resolved,
 * so awaiting it commits without waiting (§5).
 */

import type { NativeContext, Natives, WithFutures } from '../../runtime/natives.ts';
import type { NativeKeys } from '../std-module.ts';

export const runtimeNatives = (keys: NativeKeys): Natives<NativeContext & WithFutures> => ({
  [keys.of('commit')]: (_arguments, context) => context.futures.resolved(null),
});
