/**
 * The prelude's natives over `Instance<T>` (spec §9): `result()`, a wait on the instance's end,
 * which the runtime resolves from the instance's last commit
 * (runtime/scheduler/instance/instance-ends.ts).
 */

import { parameterKey } from '../../definition/extern-key.ts';
import { instanceNameOf } from '../../definition/values/instance-handles.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import type { NativeContext, Natives, WithInstances } from '../../runtime/natives.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { resultTypeArgument } from '../values/results.ts';

export const instanceNatives = (keys: NativeKeys): Natives<NativeContext & WithInstances> => ({
  [keys.of('result', knownTypeKey(wellKnown.instance, parameterKey('T')))]: ([handle], context) =>
    context.instances.ended(instanceNameOf(handle), resultTypeArgument(context, 0)),
});
