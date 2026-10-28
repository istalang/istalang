/**
 * The prelude's natives for strings as sequences (§3.8, §3.9, §3.10). A string is a sequence of
 * code points, as in Python, so its length, indexing, slicing and iteration all count code points
 * and never split one; the runtime holds it as a JavaScript string, whose iterator gives code
 * points. Its cursor steps by UTF-16 offset instead (`_characterAt`), so each step reads one code
 * point where it starts.
 */

import { wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { codePointAtPosition, codePointCount, codePointSlice } from '../../text/code-points.ts';
import { int, resultOptional, text } from '../native-values.ts';
import { atPosition, checkedIndex, selectionOf } from '../positions.ts';
import { rangeOf } from '../ranges.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

const range = knownTypeKey(wellKnown.range);
const what = 'a string';

export const stringNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('length', 'string')]: ([s]) => BigInt(codePointCount(text(s))),
  [keys.of('at', 'string', 'int')]: ([s, index], context) => {
    const whole = text(s);
    const key = int(index);
    const position = key >= 0n ? Number(key) : atPosition(key, codePointCount(whole));
    return resultOptional(
      context,
      position === undefined ? undefined : codePointAtPosition(whole, position),
    );
  },
  [keys.of('includes', 'string', 'string')]: ([s, search]) => text(s).includes(text(search)),
  [keys.of('index', 'string', 'int')]: ([s, index]) => {
    const whole = text(s);
    const key = int(index);
    const found = key >= 0n ? codePointAtPosition(whole, Number(key)) : undefined;
    return (
      found ?? codePointAtPosition(whole, checkedIndex(key, codePointCount(whole), what)) ?? ''
    );
  },
  [keys.of('index', 'string', range)]: ([s, span], context) => {
    const whole = text(s);
    const selection = selectionOf(rangeOf(context, span), codePointCount(whole), what);
    return selection.kind === 'span'
      ? codePointSlice(whole, selection.start, selection.end)
      : selection.positions.map((position) => codePointAtPosition(whole, position) ?? '').join('');
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
