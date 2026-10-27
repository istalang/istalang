/**
 * The `strings` module's natives (strings.ista): string methods with JavaScript's names (§3.8).
 *
 * Positions and lengths count code points, as a string's indexing does, while JavaScript counts
 * UTF-16 units: each native works on the UTF-16 text and converts positions at its edge
 * (text/code-points.ts). Where JavaScript would split a code point, as an empty search or
 * separator does, it steps over code points instead.
 *
 * Case mapping is Unicode's default, never a locale's, and graphemes are segmented by the root
 * locale, so the machine's locale never changes a result; the Unicode tables are the Node build's, so
 * a segment re-run on a newer Node may map a newly assigned code point differently. A string longer
 * than JavaScript can hold is a limit the program ran into, so building one panics (§3.12), as the
 * segment running a native makes every such limit do (runtime/scheduler/segment/limits.ts).
 */

import { elementsOf } from '../../definition/values.ts';
import { wellKnown } from '../../language/well-known.ts';
import { type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import { codePointPositions, codePoints, utf16Offset } from '../../text/code-points.ts';
import { arrayOf, int, optionalValue, text } from '../native-values.ts';
import { sliced } from '../positions.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { formatted } from './format.ts';

const optionalInt = knownTypeKey(wellKnown.optional, 'int');
const strings = knownTypeKey(wellKnown.array, 'string');

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export const stringsNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  ...reading(keys),
  ...splitting(keys),
  ...building(keys),
});

const reading = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('indexOf', 'string', 'string', 'int')]: ([s, search, from]) => {
    const whole = text(s);
    return position(whole, whole.indexOf(text(search), utf16Offset(whole, Number(int(from)))));
  },
  [keys.of('lastIndexOf', 'string', 'string')]: ([s, search]) => {
    const whole = text(s);
    return position(whole, whole.lastIndexOf(text(search)));
  },
  [keys.of('includes', 'string', 'string')]: ([s, search]) => text(s).includes(text(search)),
  [keys.of('startsWith', 'string', 'string')]: ([s, prefix]) => text(s).startsWith(text(prefix)),
  [keys.of('endsWith', 'string', 'string')]: ([s, suffix]) => text(s).endsWith(text(suffix)),
  [keys.of('utf16Length', 'string')]: ([s]) => BigInt(text(s).length),
});

const splitting = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('slice', 'string', 'int', optionalInt)]: ([s, start, end]) => {
    const last = optionalValue(end);
    const points = codePoints(text(s));
    return sliced(points, int(start), last === undefined ? undefined : int(last)).join('');
  },
  [keys.of('split', 'string', 'string')]: ([s, separator]) => {
    const by = text(separator);
    return arrayOf(by === '' ? codePoints(text(s)) : text(s).split(by));
  },
  [keys.of('trim', 'string')]: ([s]) => text(s).trim(),
  [keys.of('trimStart', 'string')]: ([s]) => text(s).trimStart(),
  [keys.of('trimEnd', 'string')]: ([s]) => text(s).trimEnd(),
  [keys.of('graphemes', 'string')]: ([s]) =>
    arrayOf([...graphemeSegmenter.segment(text(s))].map(({ segment }) => segment)),
});

const building = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('padStart', 'string', 'int', 'string')]: ([s, length, fill]) =>
    padding(text(s), int(length), text(fill)) + text(s),
  [keys.of('padEnd', 'string', 'int', 'string')]: ([s, length, fill]) =>
    text(s) + padding(text(s), int(length), text(fill)),
  [keys.of('repeat', 'string', 'int')]: ([s, count]) => repeated(text(s), int(count)),
  [keys.of('replace', 'string', 'string', 'string')]: ([s, search, replacement]) =>
    replacedFirst(text(s), text(search), text(replacement)),
  [keys.of('replaceAll', 'string', 'string', 'string')]: ([s, search, replacement]) =>
    replacedAll(text(s), text(search), text(replacement)),
  [keys.of('toUpperCase', 'string')]: ([s]) => text(s).toUpperCase(),
  [keys.of('toLowerCase', 'string')]: ([s]) => text(s).toLowerCase(),
  [keys.of('_format', 'string', strings)]: ([template, values]) =>
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

/** `s` with every `search` replaced; an empty search is found before each code point and at the end. */
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

/** What pads `s` to `length` code points: `fill` repeated and cut to fit; none when it is long enough. */
function padding(s: string, length: bigint, fill: string): string {
  const missing = Number(length) - codePoints(s).length;
  const fillPoints = codePoints(fill);
  if (missing <= 0 || fillPoints.length === 0) {
    return '';
  }
  return (
    fill.repeat(Math.floor(missing / fillPoints.length)) +
    fillPoints.slice(0, missing % fillPoints.length).join('')
  );
}
