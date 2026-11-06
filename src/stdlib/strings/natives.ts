/**
 * The `strings` module's natives (strings.ista): string methods with JavaScript's names (§3.8).
 *
 * Positions and lengths count code points, as a string's indexing does, while JavaScript counts
 * UTF-16 units: each native works on the UTF-16 text and converts positions at its edge
 * (text/code-points.ts). Where JavaScript would split a code point, as an empty search or
 * separator does, it steps over code points instead.
 *
 * Case mapping is Unicode's default, never a locale's, and graphemes are segmented by the root
 * locale, so the machine's locale never changes a result; the Unicode tables are the Node build's,
 * so a segment re-run on a newer Node may map a newly assigned code point differently. A string
 * longer than JavaScript can hold is a limit the program ran into, so building one panics (§3.12),
 * as the segment running a native makes every such limit do (runtime/scheduler/segment/limits.ts).
 */

import { restKey } from '../../definition/extern-key.ts';
import { elementsOf } from '../../definition/values/values.ts';
import { wellKnown } from '../../language/well-known/index.ts';
import { type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import {
  codePointCount,
  codePointPositions,
  codePointSlice,
  codePoints,
  utf16Offset,
} from '../../text/code-points.ts';
import { arrayOf, int, optionalInt, text } from '../native-values.ts';
import { sliceBounds } from '../positions.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { formatted } from './format.ts';

const optionalIntKey = knownTypeKey(wellKnown.optional, 'Int');
const strings = knownTypeKey(wellKnown.array, 'String');

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export const stringsNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  ...reading(keys),
  ...splitting(keys),
  ...building(keys),
});

const reading = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('indexOf', 'String', 'String', 'Int')]: ([s, search, from]) => {
    const whole = text(s);
    return position(whole, whole.indexOf(text(search), utf16Offset(whole, Number(int(from)))));
  },
  [keys.of('lastIndexOf', 'String', 'String')]: ([s, search]) => {
    const whole = text(s);
    return position(whole, whole.lastIndexOf(text(search)));
  },
  [keys.of('startsWith', 'String', 'String')]: ([s, prefix]) => text(s).startsWith(text(prefix)),
  [keys.of('endsWith', 'String', 'String')]: ([s, suffix]) => text(s).endsWith(text(suffix)),
  [keys.of('utf16Length', 'String')]: ([s]) => BigInt(text(s).length),
});

const splitting = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('slice', 'String', 'Int', optionalIntKey)]: ([s, start, end], context) => {
    const whole = text(s);
    const bounds = sliceBounds(codePointCount(whole), int(start), optionalInt(context, end));
    return codePointSlice(whole, bounds.start, bounds.end);
  },
  [keys.of('split', 'String', 'String')]: ([s, separator]) => {
    const by = text(separator);
    return arrayOf(by === '' ? codePoints(text(s)) : text(s).split(by));
  },
  [keys.of('trim', 'String')]: ([s]) => text(s).trim(),
  [keys.of('trimStart', 'String')]: ([s]) => text(s).trimStart(),
  [keys.of('trimEnd', 'String')]: ([s]) => text(s).trimEnd(),
  [keys.of('graphemes', 'String')]: ([s]) =>
    arrayOf([...graphemeSegmenter.segment(text(s))].map(({ segment }) => segment)),
});

const building = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('padStart', 'String', 'Int', 'String')]: ([s, length, fill]) =>
    padding(text(s), int(length), text(fill)) + text(s),
  [keys.of('padEnd', 'String', 'Int', 'String')]: ([s, length, fill]) =>
    text(s) + padding(text(s), int(length), text(fill)),
  [keys.of('repeat', 'String', 'Int')]: ([s, count]) => repeated(text(s), int(count)),
  [keys.of('replace', 'String', 'String', 'String')]: ([s, search, replacement]) =>
    replacedFirst(text(s), text(search), text(replacement)),
  [keys.of('replaceAll', 'String', 'String', 'String')]: ([s, search, replacement]) =>
    replacedAll(text(s), text(search), text(replacement)),
  [keys.of('toUpperCase', 'String')]: ([s]) => text(s).toUpperCase(),
  [keys.of('toLowerCase', 'String')]: ([s]) => text(s).toLowerCase(),
  [keys.of('format', 'String', restKey(strings))]: ([template, values]) =>
    formatted(text(template), elementsOf(values).map(text)),
});

/** `s` repeated `count` times; a negative count is a bug in the program. */
function repeated(s: string, count: bigint): string {
  if (count < 0n) {
    throw new Panic(`A string can't be repeated ${count} times.`);
  }
  return s === '' ? '' : s.repeat(Number(count));
}

/** `s` with its first `search` replaced; an empty search is found at the start. */
function replacedFirst(s: string, search: string, replacement: string): string {
  const found = s.indexOf(search);
  return found < 0 ? s : s.slice(0, found) + replacement + s.slice(found + search.length);
}

/**
 * `s` with every `search` replaced; an empty search is found before each code point and at the end.
 */
function replacedAll(s: string, search: string, replacement: string): string {
  if (search === '') {
    return `${codePoints(s)
      .map((point) => replacement + point)
      .join('')}${replacement}`;
  }
  return s.split(search).join(replacement);
}

/** Where UTF-16 offset `found` of `whole` is, in code points; -1 stays -1, as nothing found. */
function position(whole: string, found: number): bigint {
  return found < 0 ? -1n : BigInt(codePointPositions(whole)(found));
}

/**
 * What pads `s` to `length` code points: `fill` repeated and cut to fit; none when it is long
 * enough.
 */
function padding(s: string, length: bigint, fill: string): string {
  const missing = Number(length) - codePointCount(s);
  const fillLength = codePointCount(fill);
  if (missing <= 0 || fillLength === 0) {
    return '';
  }
  return (
    fill.repeat(Math.floor(missing / fillLength)) + codePointSlice(fill, 0, missing % fillLength)
  );
}
