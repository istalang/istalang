/**
 * The natives of the prelude's waits (proposal 8, Rule 5): a future's `onAwait`, the runtime's
 * awaitable, and a `Resolver`'s `resolve` and `tryResolve`. Deciding a wait, and the order waits
 * decided together resume in, are the runtime's (runtime/scheduler/instance/waits.ts).
 */

import { parameterKey } from '../../definition/extern-key.ts';
import { awaitFunction } from '../../foundation/language/well-known/implicit-calls.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import type { NativeContext, Natives, WithWaits } from '../../runtime/natives.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { given } from '../values/arguments.ts';

const value = parameterKey('T');
const kind = parameterKey('K');
const future = knownTypeKey(wellKnown.future, value, kind);
const resolver = knownTypeKey(wellKnown.resolver, value, kind);

export const waitNatives = (keys: NativeKeys): Natives<NativeContext & WithWaits> => ({
  [keys.of(awaitFunction, future, resolver)]: ([awaited, done], context) => {
    context.waits.onAwait(given(awaited), given(done));
    return null;
  },
  [keys.of('resolve', resolver, value)]: ([done, resolved], context) => {
    context.waits.resolve(given(done), given(resolved));
    return null;
  },
  [keys.of('tryResolve', resolver, value)]: ([done, resolved], context) =>
    context.waits.tryResolve(given(done), given(resolved)),
});
