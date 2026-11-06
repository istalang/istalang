/**
 * The `futures` module's natives (futures.ista): `first`, the runtime primitive that races a list
 * of futures (§3.8). What it waits on, and which position wins when several resolved together, are
 * the runtime's (runtime/scheduler/instance/futures.ts).
 */

import { parameterKey } from '../../definition/extern-key.ts';
import { elementsOf } from '../../definition/values/values.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import type { NativeContext, Natives, WithFutures } from '../../runtime/natives.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

const futures = knownTypeKey(wellKnown.array, knownTypeKey(wellKnown.future, parameterKey('T')));

export const futuresNatives = (keys: NativeKeys): Natives<NativeContext & WithFutures> => ({
  [keys.of('first', futures)]: ([racing], context) => context.futures.first(elementsOf(racing)),
});
