/**
 * The prelude's natives over `Instance<T>` (spec §9): `result()`, a wait on the instance's end,
 * which the runtime resolves from the instance's last commit (runtime/scheduler/instance-ends.ts).
 * An `Instance<T>` holds the name of the instance it is a handle to.
 */

import { parameterKey } from '../../definition/extern-key.ts';
import { instanceNameOf } from '../../definition/instance-handles.ts';
import { wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives, WithInstances } from '../../runtime/natives.ts';
import { resultTypeArgument } from '../native-values.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

export const instanceNatives = (keys: NativeKeys): Natives<NativeContext & WithInstances> => ({
  [keys.of('result', knownTypeKey(wellKnown.instance, parameterKey('T')))]: ([handle], context) =>
    context.instances.ended(instanceNameOf(handle), resultTypeArgument(context, 0)),
});
