/**
 * The prelude's natives for strings as sequences (§3.8, §3.9, §3.10). A string is a sequence of
 * code points, as in Python, so its length, indexing, slicing and iteration all count code points
 * and never split one; the runtime holds it as a JavaScript string, whose iterator gives code
 * points. Its cursor steps by UTF-16 offset instead (`_characterAt`), so each step reads one code
 * point where it starts.
 */

import { wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { int, resultOptional, text } from '../native-values.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { atPosition, checkedIndex, spanOf } from './positions.ts';

const range = knownTypeKey(wellKnown.range);
const what = 'a string';

const codePoints = (value: Parameters<typeof text>[0]): readonly string[] => [...text(value)];

export const stringNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('length', 'string')]: ([s]) => BigInt(codePoints(s).length),
  [keys.of('at', 'string', 'int')]: ([s, index], context) => {
    const points = codePoints(s);
    const position = atPosition(int(index), points.length);
    return resultOptional(context, position === undefined ? undefined : points[position]);
  },
  [keys.of('index', 'string', 'int')]: ([s, index]) => {
    const points = codePoints(s);
    return points[checkedIndex(int(index), points.length, what)] ?? '';
  },
  [keys.of('index', 'string', range)]: ([s, span]) => {
    const points = codePoints(s);
    return points.slice(...spanOf(span ?? null, points.length, what)).join('');
  },
  [keys.of('_characterAt', 'string', 'int')]: ([s, offset], context) => {
    const whole = text(s);
    const start = Number(int(offset));
    const point = whole.codePointAt(start);
    if (point === undefined) {
      return resultOptional(context, undefined);
    }
    const character = String.fromCodePoint(point);
    return resultOptional(context, {
      kind: 'tuple',
      elements: [character, BigInt(start + character.length)],
    });
  },
});
