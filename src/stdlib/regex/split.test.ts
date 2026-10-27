/**
 * `regex.split` cuts as JavaScript's `split` does with a Unicode pattern, for patterns RE2 and
 * JavaScript read alike and that capture nothing: empty matches included, which split between code
 * points and never at the ends.
 */

import fc from 'fast-check';
import { RE2JS } from 're2js';
import { describe, expect, it } from 'vitest';
import { split } from './split.ts';

const patterns = [',', 'x*', '', '\\s+', 'a|b', '(?:ab)*', 'b?'];
const texts = fc
  .array(fc.constantFrom('a', 'b', 'x', ',', ' ', '😀'), { maxLength: 12 })
  .map((pieces) => pieces.join(''));

describe('regex split', () => {
  it.each(patterns)('cuts as JavaScript does by /%s/u', (pattern) => {
    const program = RE2JS.compile(pattern);
    fc.assert(
      fc.property(texts, (s) => {
        expect(split(program, s)).toEqual(s.split(new RegExp(pattern, 'u')));
      }),
    );
  });
});
