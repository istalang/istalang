/**
 * The prelude's natives for strings and ranges as sequences (§3.8, §3.9, §3.10). A string is a
 * sequence of code points, as in Python, so its length, indexing, slicing and iteration all count
 * code points and never split one; the runtime holds it as a JavaScript string, whose iterator
 * gives code points.
 */

import { namedKey, nativeKey, primitiveKey } from '../../definition/extern-key.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import type { Natives } from '../../runtime/natives.ts';
import { arrayOf, int, resultOptional, text } from '../native-values.ts';
import { preludeName } from '../stdlib-loader.ts';
import { atPosition, checkedIndex, rangeInts, spanOf } from './positions.ts';

const stringKey = primitiveKey('string');
const intKey = primitiveKey('int');
const range = namedKey(qualifiedName(wellKnown.range));
const what = 'a string';

const key = (name: string, ...parameters: Parameters<typeof nativeKey>[2][]) =>
  nativeKey(preludeName, name, ...parameters);

/** A string argument's code points. */
const codePoints = (value: Parameters<typeof text>[0]): readonly string[] => [...text(value)];

export const stringNatives: Natives = {
  [key('length', stringKey)]: ([s]) => BigInt(codePoints(s).length),
  [key('at', stringKey, intKey)]: ([s, index], context) => {
    const points = codePoints(s);
    const position = atPosition(int(index), points.length);
    return resultOptional(context, position === undefined ? undefined : points[position]);
  },
  [key('index', stringKey, intKey)]: ([s, index]) => {
    const points = codePoints(s);
    return points[checkedIndex(int(index), points.length, what)] ?? '';
  },
  [key('index', stringKey, range)]: ([s, span]) => {
    const points = codePoints(s);
    return points.slice(...spanOf(span ?? null, points.length, what)).join('');
  },
  [key('iterate', stringKey)]: ([s]) => arrayOf(codePoints(s)),
  [key('iterate', range)]: ([span]) => arrayOf(rangeInts(span ?? null)),
};
