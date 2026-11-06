/**
 * The natives of the prelude's weak references (spec §7): `WeakRef(x)`, `deref()` and
 * `disposed()`, and `disposing()` on an async call's handle, a watch on it like `disposed()`. What
 * a weak reference is, and when its watchers resolve, are the runtime's
 * (runtime/scheduler/instance/weak-side.ts).
 */

import { parameterKey } from '../../definition/extern-key.ts';
import { conversionFunction, wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives, WithWeakSide } from '../../runtime/natives.ts';
import { given, resultOptional } from '../native-values.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

const referent = parameterKey('T');
const weakRef = knownTypeKey(wellKnown.weakRef, referent);

export const weakNatives = (keys: NativeKeys): Natives<NativeContext & WithWeakSide> => ({
  [keys.ofStatic(wellKnown.weakRef.name, conversionFunction, referent)]: ([value], context) =>
    context.weak.reference(given(value)),
  [keys.of('deref', weakRef)]: ([weak], context) =>
    resultOptional(context, context.weak.target(given(weak))),
  [keys.of('disposed', weakRef)]: ([weak], context) => context.weak.watch(given(weak)),
  [keys.of('disposing', knownTypeKey(wellKnown.call))]: ([call], context) =>
    context.weak.watch(given(call)),
});
