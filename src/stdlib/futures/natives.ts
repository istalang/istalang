/**
 * The `futures` module's natives (futures.ista): `first`, the runtime primitive that races a list
 * of futures (§3.8). What it waits on, and which position wins when several resolved together, are
 * the runtime's (runtime/scheduler/futures.ts).
 */

import { namedKey, nativeKey, parameterKey } from '../../definition/extern-key.ts';
import { elementsOf } from '../../definition/values.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import type { Natives } from '../../runtime/natives.ts';
import { futuresName } from '../stdlib-loader.ts';

const futures = namedKey(
  qualifiedName(wellKnown.array),
  namedKey(qualifiedName(wellKnown.future), parameterKey('T')),
);

export const futuresNatives: Natives = {
  [nativeKey(futuresName, 'first', futures)]: ([racing], context) =>
    context.first(elementsOf(racing)),
};
