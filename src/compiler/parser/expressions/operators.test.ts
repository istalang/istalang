/**
 * Operators at their §3.9 levels: grouping and associativity spot checks, `is`, ranges, and the
 * reports for `??` mixed with `and`/`or` and for loose prefix operators in tight positions.
 */

import { describe, expect, it } from 'vitest';
import { parserDiagnostics } from '../diagnostics.ts';
import { dumpClean, reported, reportedOnce } from '../parse.test-kit.ts';

describe('levels and associativity', () => {
  it.each([
    ['a or b and c', '(Binary a or (Binary b and c))'],
    ['a - b - c', '(Binary (Binary a - b) - c)'],
    ['a // b % c', '(Binary (Binary a // b) % c)'],
    ['a + b * c', '(Binary a + (Binary b * c))'],
    ['not a == b', '(Unary not (Binary a == b))'],
    ['not a and b', '(Binary (Unary not a) and b)'],
    ['not not a', '(Unary not (Unary not a))'],
    ['-a * b', '(Binary (Unary - a) * b)'],
    ['- -a', '(Unary - (Unary - a))'],
    ['-a.b', '(Unary - (MemberAccess a b))'],
    ['await a.b()', '(Await (Call (MemberAccess a b) [] []))'],
    ['a ?? b ?? c', '(Binary (Binary a ?? b) ?? c)'],
    ['name ?? "anonymous"', '(Binary name ?? "anonymous")'],
    ['(a ?? b) or c', '(Binary (Parenthesized (Binary a ?? b)) or c)'],
    ['a ?? (b or c)', '(Binary a ?? (Parenthesized (Binary b or c)))'],
    ['a < b == c', '(Binary (Binary a < b) == c)'],
  ])('groups %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});

describe('is and ranges', () => {
  it.each([
    ['x is Ok{value}', '(Is x (StructPattern (NamedType [Ok] []) [(BindFieldPattern value _)]))'],
    [
      'r is Ok{value as y} and y > 0',
      '(Binary (Is r (StructPattern (NamedType [Ok] []) [(BindFieldPattern value y)])) and (Binary y > 0))',
    ],
    ['not x is P', '(Unary not (Is x (NamePattern [P])))'],
    ['x is P < y', '(Binary (Is x (NamePattern [P])) < y)'],
    ['0..10', '(Range 0 10)'],
    ['0..=10', '(Range 0 isInclusive 10)'],
    ['..5', '(Range _ 5)'],
    ['..=5', '(Range _ isInclusive 5)'],
    ['3..', '(Range 3 _)'],
    ['..', '(Range _ _)'],
    ['a..b + 1', '(Range a (Binary b + 1))'],
    ['a..b == c', '(Binary (Range a b) == c)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});

describe('reports', () => {
  const { expected, mixedCoalesce, operatorNeedsParentheses } = parserDiagnostics;

  it.each([
    ['a ?? b or c', mixedCoalesce.code, 'b or c'],
    ['a or b ?? c', mixedCoalesce.code, 'a or b'],
    ['a and b ?? c', mixedCoalesce.code, 'a and b'],
    ['a == not b', operatorNeedsParentheses.code, 'not'],
    ['a + ..b', operatorNeedsParentheses.code, '..'],
    ['0..=', expected.code, ''],
    ['1 +', expected.code, ''],
    ['1 + )', expected.code, ')'],
    ['a +\nb', expected.code, ''],
  ])('reports %j once', (text, code, spanText) => {
    expect(reported('expression', text)).toEqual(reportedOnce(code, spanText));
  });
});
