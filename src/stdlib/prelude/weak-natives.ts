/**
 * The natives of the prelude's weak references (spec §7): `WeakRef(x)`, `deref()` and
 * `disposed()`, and `disposing()` on an async call's handle, a watch on it like `disposed()`. What
 * a weak reference is, and when its watchers resolve, are the runtime's
 * (runtime/run/weak-references.ts).
 */

import { type NativeKeys, parameterKey } from '../../definition/extern-key.ts';
import { conversionFunction } from '../../foundation/language/well-known/implicit-calls.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { NativeContext, Natives, WithWeakSide } from '../../runtime/natives.ts';
import { knownTypeKey } from '../std-module.ts';
import { given } from '../values/arguments.ts';

const referent = parameterKey('T');
const weakRef = knownTypeKey(wellKnown.weakRef, referent);

export const weakNatives = (keys: NativeKeys): Natives<NativeContext & WithWeakSide> => ({
  [keys.ofStatic(wellKnown.weakRef.name, conversionFunction, referent)]: ([value], context) =>
    context.weak.reference(given(value)),
  [keys.of('_held', weakRef)]: ([weak], context) => context.weak.target(given(weak)) !== undefined,
  [keys.of('_referent', weakRef)]: ([weak], context) =>
    context.weak.target(given(weak)) ?? unreachable('A weak reference no one holds is read.'),
  [keys.of('disposed', weakRef)]: ([weak], context) => context.weak.watch(given(weak)),
  [keys.of('disposing', knownTypeKey(wellKnown.call))]: ([call], context) =>
    context.weak.watch(given(call)),
});
