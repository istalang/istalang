/**
 * Clarifying parentheses (clarifying-parentheses.ts): added where an operation mixes operators
 * people misread, never where it doesn't, and never changing what the expression means.
 */

import { describe, expect, it } from 'vitest';
import { lines, roundTripOf } from '../format.test-kit.ts';
import { formatText } from '../format.ts';

const formattedValue = (expression: string) =>
  formatText(lines(`const x = ${expression}`))
    ?.trimEnd()
    .replace('const x = ', '');

describe('clarifying parentheses', () => {
  it.each([
    ['a or b and c', 'a or (b and c)'],
    ['a and b or c', '(a and b) or c'],
    ['a & b == c', '(a & b) == c'],
    ['a & b | c', '(a & b) | c'],
    ['a | b ^ c & d', 'a | (b ^ (c & d))'],
    ['a << b + c', 'a << (b + c)'],
    ['a ** b & c', '(a ** b) & c'],
    ['a < b & c < d', 'a < (b & c) < d'],
    ['a & 1 is 0', '(a & 1) is 0'],
    ['a * b % c', '(a * b) % c'],
    ['a % b // c', '(a % b) // c'],
    ['not a == b', 'not (a == b)'],
    ['not a < b < c', 'not (a < b < c)'],
    ['not a in b', 'not (a in b)'],
  ])('wraps the tighter operand of %s', (written, formatted) => {
    expect(formattedValue(written)).toBe(formatted);
    expect(formattedValue(formatted)).toBe(formatted);
  });

  it.each([
    'a or b or c',
    'a and b and c',
    '(a or b) and c',
    'a & b & c',
    'a << b >> c',
    'a + b * c',
    'a * b / c',
    'a % b % c',
    'a == b and c',
    'not a and b',
    'a ?? b',
    '-a * b ** 2',
  ])('adds none to %s', (written) => {
    expect(formattedValue(written)).toBe(written);
  });

  it('keeps what the expression means, comments and line breaks included', () => {
    const text = lines(
      'fn f(): g(',
      '  a or b and c # why',
      '  firstOperandName & secondOperandName == thirdOperandName and fourthName % fifth * sixth',
      ')',
    );
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });
});
