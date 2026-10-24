/**
 * The `runtime` module's natives (runtime.ista). `commit()` is a future that is already resolved,
 * so awaiting it commits without waiting (§5).
 */

import type { Natives } from '../../runtime/natives.ts';
import { nativeKey } from '../native-keys.ts';
import { runtimeName } from '../stdlib-loader.ts';

export const runtimeNatives: Natives = {
  [nativeKey(runtimeName, 'commit')]: (_arguments, context) => context.resolved(null),
};
