/**
 * The `strings` module's natives (strings.ista): the string methods that are JavaScript's or
 * Unicode's own, and the searching and cutting by UTF-16 offset the module's code is written over.
 *
 * Positions and lengths count code points, as a string's indexing does, while JavaScript counts
 * UTF-16 units: `indexOf` and `slice` work on the UTF-16 text and convert positions at their edge
 * (foundation/text/code-points.ts). Where JavaScript would split a code point, as an empty search
 * does, they step over code points instead.
 *
 * Case mapping is Unicode's default, never a locale's, and graphemes are segmented by the root
 * locale, so the machine's locale never changes a result; the Unicode tables are the Node build's,
 * so a segment re-run on a newer Node may map a newly assigned code point differently. A string
 * longer than JavaScript can hold is a limit the program ran into, so building one panics (§3.12),
 * as the run makes every such limit do (runtime/natives.ts `panicOf`).
 */

import type { NativeKeys } from '../../definition/extern-key.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import {
  codePointCount,
  codePointPositions,
  codePointSlice,
  utf16Offset,
} from '../../foundation/text/code-points.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { sliceBounds } from '../positions.ts';
import { knownTypeKey } from '../std-module.ts';
import { arrayOf, int, optionalInt, text } from '../values/arguments.ts';

const optionalIntKey = knownTypeKey(wellKnown.optional, 'Int');

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export const stringsNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('indexOf', 'String', 'String', 'Int')]: ([s, search, from]) => {
    const whole = text(s);
    const found = whole.indexOf(text(search), utf16Offset(whole, Number(int(from))));
    return found < 0 ? -1n : BigInt(codePointPositions(whole)(found));
  },
  [keys.of('slice', 'String', 'Int', optionalIntKey)]: ([s, start, end], context) => {
    const whole = text(s);
    const bounds = sliceBounds(codePointCount(whole), int(start), optionalInt(context, end));
    return codePointSlice(whole, bounds.start, bounds.end);
  },
  [keys.of('trim', 'String')]: ([s]) => text(s).trim(),
  [keys.of('trimStart', 'String')]: ([s]) => text(s).trimStart(),
  [keys.of('trimEnd', 'String')]: ([s]) => text(s).trimEnd(),
  [keys.of('toUpperCase', 'String')]: ([s]) => text(s).toUpperCase(),
  [keys.of('toLowerCase', 'String')]: ([s]) => text(s).toLowerCase(),
  [keys.of('graphemes', 'String')]: ([s]) =>
    arrayOf([...graphemeSegmenter.segment(text(s))].map(({ segment }) => segment)),
  [keys.of('utf16Length', 'String')]: ([s]) => BigInt(text(s).length),
  [keys.of('_find', 'String', 'String', 'Int')]: ([s, search, offset]) =>
    BigInt(text(s).indexOf(text(search), Number(int(offset)))),
  [keys.of('_between', 'String', 'Int', 'Int')]: ([s, start, end]) =>
    text(s).slice(Number(int(start)), Number(int(end))),
});
