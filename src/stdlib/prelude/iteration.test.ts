/**
 * Iterating (§3.10): `for` runs the cursor `iterate` gives, item by item, so a range never holds
 * its ints, a string steps over code points, a map gives its entries in order, and changing the
 * original meanwhile changes nothing. A spread takes the same items, except that an array into an
 * array literal and a map into a map literal are copied whole.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mainGives } from './prelude.test-kit.ts';

const ends = fc.integer({ min: -5, max: 5 });

/** Printable ASCII a string literal holds as it is. */
const plain = /^[ !#-[\]-~]$/u;

/** `text` as a string literal, each code point but plain ASCII escaped as `\u{…}`. */
function literalOf(text: string): string {
  const points = [...text].map((point) =>
    plain.test(point) ? point : `\\u{${point.codePointAt(0)?.toString(16)}}`,
  );
  return `"${points.join('')}"`;
}

describe('a cursor', () => {
  it('gives the ints from a range start below its end, and nothing from any other', () => {
    fc.assert(
      fc.property(ends, ends, (start, end) => {
        const ints = Array.from(
          { length: Math.max(0, end - start) },
          (_, offset) => start + offset,
        );
        expect(mainGives('Array<Int>', `[for i in ${start}..${end}: i]`)).toEqual(ints);
      }),
      { numRuns: 10 },
    );
  });

  it('steps a range one int at a time, never holding the ints it covers', () => {
    const body = [
      'let last = 0',
      'for i in 0..4_294_967_301:',
      '  last = i',
      '  if i == 3: break',
      'last',
    ];
    expect(mainGives('Int', body.join('\n  '))).toBe(3);
  });

  it("gives a string's code points, astral ones whole", () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 6 }), (text) => {
        expect(mainGives('Array<String>', `[for c in ${literalOf(text)}: c]`)).toEqual([...text]);
      }),
      { numRuns: 10 },
    );
  });

  it("gives a map's entries in its order", () => {
    expect(mainGives('Array<String>', '[for k, v in ["b": 1, "a": 2]: k + v]')).toEqual([
      'b1',
      'a2',
    ]);
  });

  it('gives every item of an array of optionals, a stored none never ending it', () => {
    fc.assert(
      fc.property(fc.array(fc.option(ends, { nil: null }), { maxLength: 4 }), (items) => {
        const literal = items.map((item) => item ?? 'none').join(', ');
        const body = `const xs: Array<Int?> = [${literal}]\n  [for x in xs: x]`;
        expect(mainGives('Array<Int?>', body)).toEqual(items);
      }),
      { numRuns: 10 },
    );
  });

  it('runs over what it was given, whatever the loop changes meanwhile', () => {
    const body = [
      'let xs = [1, 2]',
      'let seen = 0',
      'for x in xs:',
      '  xs.push(x)',
      '  seen += 1',
      'seen',
    ];
    expect(mainGives('Int', body.join('\n  '))).toBe(2);
  });
});

describe('a spread', () => {
  it.each([
    ['a range, then an item', 'Array<Int>', '[...0..3, 9]', [0, 1, 2, 9]],
    [
      'an array, a string and a map into an array',
      'Array<String>',
      '[...["x"], ..."ab", ...[for k, _ in ["m": 1]: k]]',
      ['x', 'a', 'b', 'm'],
    ],
    ["a map's entries into an array", 'Array<(String, Int)>', '[...["m": 1]]', [['m', 1]]],
    [
      'a map and tuples into a map',
      'Map<String, Int>',
      '["a": 0, ...["b": 1], ...[("c", 2)], "a": 3]',
      { a: 3, b: 1, c: 2 },
    ],
  ])('takes the items of %s', (_, type, literal, expected) => {
    expect(mainGives(type, literal)).toEqual(expected);
  });
});
