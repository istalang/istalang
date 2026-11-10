/**
 * The `time` module's natives (time.ista): the runtime's one clock and one time primitive, and the
 * ISO 8601 text of times and durations (iso.ts), and their readings in time zones (zones.ts).
 *
 * `now()` is the time the segment started (§5), so every read in a segment agrees and a re-run
 * segment sees the same time. `at(t)` is a future the runtime resolves once `t` is due, in the
 * first segment that starts at or after it. A time a JavaScript `Date` can't hold has no ISO text,
 * which only a program's own arithmetic can reach, so writing one panics (§3.12).
 */

import { wellKnown } from '../../foundation/language/well-known/index.ts';
import {
  type Native,
  type NativeContext,
  type Natives,
  Panic,
  type WithFutures,
} from '../../runtime/natives.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { text } from '../values/arguments.ts';
import { parseResult } from '../values/results.ts';
import { millisecondsOf, okMilliseconds, resultMilliseconds } from './fields.ts';
import { durationText, readDuration, readTime, timeText } from './iso.ts';
import { zoneNatives } from './zones.ts';

const timeType = knownTypeKey(wellKnown.time);
const durationType = knownTypeKey(wellKnown.duration);

export const timeNatives = (keys: NativeKeys): Natives<NativeContext & WithFutures> => ({
  [keys.of('now')]: (_arguments, context) => resultMilliseconds(context, context.now()),
  [keys.of('at', timeType)]: ([time], context) =>
    context.futures.timer(millisecondsOf(context, time)),
  [keys.of('toString', timeType)]: ([time], context) => {
    const milliseconds = millisecondsOf(context, time);
    const written = timeText(milliseconds);
    if (written === undefined) {
      throw new Panic(`The time ${milliseconds} ms from the epoch has no ISO 8601 text.`);
    }
    return written;
  },
  [keys.of('toString', durationType)]: ([duration], context) =>
    durationText(millisecondsOf(context, duration)),
  [keys.ofStatic(wellKnown.time.name, 'parse', 'String')]: parsedStruct(
    'an ISO 8601 time',
    readTime,
  ),
  [keys.ofStatic(wellKnown.duration.name, 'parse', 'String')]: parsedStruct(
    'an ISO 8601 duration',
    readDuration,
  ),
  ...zoneNatives(keys),
});

/** A `parse` reading a `Time` or a `Duration`, its milliseconds, with `read` (§3.10). */
function parsedStruct(
  what: string,
  read: (source: string) => bigint | undefined,
): Native<NativeContext> {
  return ([source], context) => {
    const milliseconds = read(text(source));
    const parsed = milliseconds === undefined ? undefined : okMilliseconds(context, milliseconds);
    return parseResult(context, text(source), what, parsed);
  };
}
