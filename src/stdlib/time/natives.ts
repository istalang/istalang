/**
 * The `time` module's natives (time.ista): the runtime's one clock and one time primitive, and the
 * ISO 8601 text of times and durations (iso.ts).
 *
 * `now()` is the time the segment started (§5), so every read in a segment agrees and a re-run
 * segment sees the same time. `at(t)` is a future the runtime resolves once `t` is due, in the
 * first segment that starts at or after it. A time a JavaScript `Date` can't hold has no ISO text,
 * which only a program's own arithmetic can reach, so writing one panics (§3.12).
 */

import { namedKey, nativeKey, primitiveKey } from '../../definition/extern-key.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import type { NativeContext, NativeTimers } from '../../runtime/natives.ts';
import { type Natives, Panic } from '../../runtime/natives.ts';
import { fieldOf, int, resultError, resultOkStruct, resultStruct, text } from '../native-values.ts';
import { parseErrorCode } from '../prelude/text-forms.ts';
import { timeName } from '../stdlib-loader.ts';
import { durationText, readDuration, readTime, timeText } from './iso.ts';

const timeType = namedKey(qualifiedName(wellKnown.time));
const durationType = namedKey(qualifiedName(wellKnown.duration));
const stringType = primitiveKey('string');

export const timeNatives: Natives<NativeContext & NativeTimers> = {
  [nativeKey(timeName, 'now')]: (_arguments, context) =>
    resultStruct(context, [context.segmentStartedAt]),
  [nativeKey(timeName, 'at', timeType)]: ([time], context) => context.timer(int(fieldOf(time, 0))),
  [nativeKey(timeName, 'toString', timeType)]: ([time]) => {
    const milliseconds = int(fieldOf(time, 0));
    const written = timeText(milliseconds);
    if (written === undefined) {
      throw new Panic(`The time ${milliseconds} ms from the epoch has no ISO 8601 text.`);
    }
    return written;
  },
  [nativeKey(timeName, 'toString', durationType)]: ([duration]) =>
    durationText(int(fieldOf(duration, 0))),
  [nativeKey(timeName, 'Time.parse', stringType)]: ([source], context) => {
    const time = readTime(text(source));
    return time === undefined
      ? resultError(context, `'${text(source)}' is not an ISO 8601 time.`, parseErrorCode)
      : resultOkStruct(context, [time]);
  },
  [nativeKey(timeName, 'Duration.parse', stringType)]: ([source], context) => {
    const duration = readDuration(text(source));
    return duration === undefined
      ? resultError(context, `'${text(source)}' is not an ISO 8601 duration.`, parseErrorCode)
      : resultOkStruct(context, [duration]);
  },
};
