/**
 * The natives of the prelude's weak references (spec §7): `WeakRef(x)`, `deref()` and
 * `disposed()`, and the watch on an async call's handle that `worker.disposing()` lowers to. What
 * a weak reference is, and when its watchers resolve, are the runtime's
 * (runtime/scheduler/weak-side.ts).
 */

import { namedKey, nativeKey, parameterKey } from '../../definition/extern-key.ts';
import {
  conversionFunction,
  ownCall,
  qualifiedName,
  wellKnown,
} from '../../language/well-known.ts';
import type { Natives } from '../../runtime/natives.ts';
import { given, resultOptional } from '../native-values.ts';

const { module, name } = wellKnown.weakRef;
const referent = parameterKey('T');
const weakRef = namedKey(qualifiedName(wellKnown.weakRef), referent);

export const weakNatives: Natives = {
  [nativeKey(module, `${name}.${conversionFunction}`, referent)]: ([value], context) =>
    context.weak.reference(given(value)),
  [nativeKey(module, 'deref', weakRef)]: ([weak], context) =>
    resultOptional(context, context.weak.target(given(weak))),
  [nativeKey(module, 'disposed', weakRef)]: ([weak], context) =>
    context.weak.whenDisposed(given(weak)),
  [nativeKey(module, ownCall.watch, namedKey(qualifiedName(wellKnown.call)))]: ([call], context) =>
    context.weak.watch(given(call)),
};
