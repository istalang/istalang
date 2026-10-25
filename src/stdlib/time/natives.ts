/**
 * The `time` module's natives (time.ista): the runtime's one clock and one time primitive.
 *
 * `now()` is the time the segment started (§5), so every read in a segment agrees and a re-run
 * segment sees the same time. `at(t)` is a future the runtime resolves once `t` is due, in the
 * first segment that starts at or after it.
 */

import { namedKey, nativeKey } from '../../definition/extern-key.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import type { Natives } from '../../runtime/natives.ts';
import { fieldOf, int, resultStruct } from '../native-values.ts';
import { timeName } from '../stdlib-loader.ts';

const timeType = namedKey(qualifiedName(wellKnown.time));

export const timeNatives: Natives = {
  [nativeKey(timeName, 'now')]: (_arguments, context) =>
    resultStruct(context, [context.segmentStartedAt]),
  [nativeKey(timeName, 'at', timeType)]: ([time], context) => context.timer(int(fieldOf(time, 0))),
};
