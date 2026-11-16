/**
 * The `time` module's natives (time.ista): the runtime's one clock and one time primitive, and
 * readings in time zones (zones.ts). A time's and a duration's ISO 8601 text is the module's code.
 *
 * `now()` is the time the segment started (§5), so every read in a segment agrees and a re-run
 * segment sees the same time. `at(t)` is a future the runtime resolves once `t` is due, in the
 * first segment that starts at or after it.
 */

import { wellKnown } from '../../foundation/language/well-known/index.ts';
import type { NativeContext, Natives, WithFutures } from '../../runtime/natives.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { millisecondsOf, resultMilliseconds } from './fields.ts';
import { zoneNatives } from './zones.ts';

const timeType = knownTypeKey(wellKnown.time);

export const timeNatives = (keys: NativeKeys): Natives<NativeContext & WithFutures> => ({
  [keys.of('now')]: (_arguments, context) => resultMilliseconds(context, context.now()),
  [keys.of('at', timeType)]: ([time], context) =>
    context.futures.timer(millisecondsOf(context, time)),
  ...zoneNatives(keys),
});
