/**
 * The `time` module's natives (time.ista): the runtime's one clock and one time primitive.
 *
 * `now()` is the time the segment started (§5), so every read in a segment agrees and a re-run
 * segment sees the same time. `at(t)` is a future the runtime resolves once `t` is due, in the
 * first segment that starts at or after it.
 */

import type { Natives } from '../../runtime/natives.ts';
import { namedKeyType, nativeKey } from '../native-keys.ts';
import { fieldOf, int, resultStruct } from '../native-values.ts';
import { timeName } from '../stdlib-loader.ts';

const timeType = namedKeyType(`${timeName}.Time`);

export const timeNatives: Natives = {
  [nativeKey(timeName, 'now')]: (_arguments, context) =>
    resultStruct(context, [context.segmentStartedAt]),
  [nativeKey(timeName, 'at', timeType)]: ([time], context) => context.timer(int(fieldOf(time, 0))),
};
