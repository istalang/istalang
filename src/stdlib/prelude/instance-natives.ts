/**
 * The prelude's natives over `Instance<T>` (spec §9): `spawn`, which starts one through the one
 * spawning seam every spawning native shares (runtime/natives.ts), and `result()`, a wait on the
 * instance's end, which the runtime resolves from the instance's last commit
 * (runtime/run/end-watches.ts).
 */

import { functionKey, type NativeKeys, parameterKey } from '../../definition/extern-key.ts';
import { instanceNameOf } from '../../definition/values/instance-handles.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import type { NativeContext, Natives, WithInstances } from '../../runtime/natives.ts';
import { futureKey, knownTypeKey } from '../std-module.ts';
import { given } from '../values/arguments.ts';
import { declaredResult } from '../values/results.ts';

export const instanceNatives = (keys: NativeKeys): Natives<NativeContext & WithInstances> => ({
  [keys.of('spawn', functionKey([], futureKey(parameterKey('R'), 'ista'), 'ista'))]: (
    [entry],
    context,
  ) => context.instances.spawn(given(entry), declaredResult(context), {}),
  [keys.of('_ended', knownTypeKey(wellKnown.instance, parameterKey('T')))]: ([handle], context) =>
    context.instances.ended(instanceNameOf(handle)),
});
