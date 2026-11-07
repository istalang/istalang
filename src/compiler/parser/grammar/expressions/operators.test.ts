/**
 * Operators at their §3.9 levels: grouping and associativity spot checks, `is`, ranges, and the
 * reports for `??` mixed with `and`/`or` and for loose prefix operators in tight positions.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { dumpClean, reported } from '../../parse.test-kit.ts';

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
    ['*a + b', '(Binary (Dereference * a) + b)'],
    ['a * *b', '(Binary a * (Dereference * b))'],
    ['*a.b', '(Dereference * (MemberAccess a b))'],
    ['*a->b', '(Dereference * (MemberAccess (Dereference -> a) b))'],
    ['await a.b()', '(Await (Call (MemberAccess a b) []))'],
    ['a ?? b ?? c', '(Binary (Binary a ?? b) ?? c)'],
    ['name ?? "anonymous"', '(Binary name ?? "anonymous")'],
    ['(a ?? b) or c', '(Binary (Parenthesized (Binary a ?? b)) or c)'],
    ['a ?? (b or c)', '(Binary a ?? (Parenthesized (Binary b or c)))'],
    ['a < b == c', '(ChainedComparison [a b c] [< ==])'],
  ])('groups %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});

describe('is and ranges', () => {
  it.each([
    ['x is Ok{value}', '(Is x (StructPattern (NamedType [Ok] []) [(BindFieldPattern value _)] _))'],
    [
      'r is Ok{value as y} and y > 0',
      '(Binary (Is r (StructPattern (NamedType [Ok] []) [(BindFieldPattern value y)] _)) and (Binary y > 0))',
    ],
    ['not x is P', '(Unary not (Is x (NamePattern [P] [])))'],
    ['x is P < y', '(Binary (Is x (NamePattern [P] [])) < y)'],
    ['0..10', '(Range 0 10 _)'],
    ['0..=10', '(Range 0 isInclusive 10 _)'],
    ['..5', '(Range _ 5 _)'],
    ['..=5', '(Range _ isInclusive 5 _)'],
    ['3..', '(Range 3 _ _)'],
    ['..', '(Range _ _ _)'],
    ['a..b + 1', '(Range a (Binary b + 1) _)'],
    ['a..b == c', '(Binary (Range a b _) == c)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});

describe('reports', () => {
  const { expected, mixedOperators, operatorNeedsParentheses, prefixBeforePower } =
    parserDiagnostics;

  it.each([
    ['a ?? b or c', mixedOperators.code, 'b or c'],
    ['a or b ?? c', mixedOperators.code, 'a or b'],
    ['a and b ?? c', mixedOperators.code, 'a and b'],
    ['a == not b', operatorNeedsParentheses.code, 'not'],
    ['a + ..b', operatorNeedsParentheses.code, '..'],
    ['-2 ** 2', prefixBeforePower.code, '-2 ** 2'],
    ['~a ** b', prefixBeforePower.code, '~a ** b'],
    ['await f ** 2', prefixBeforePower.code, 'await f ** 2'],
    ['-x.y ** 2 ** 3', prefixBeforePower.code, '-x.y ** 2 ** 3'],
    ['0..=', expected.code, ''],
    ['1 +', expected.code, ''],
    ['1 + )', expected.code, ')'],
    ['a +\nb', expected.code, ''],
  ])('reports %j once', (text, code, spanText) => {
    expect(reported('expression', text)).toEqual(reportedOnce(code, spanText));
  });
});

describe('bitwise operators, `**`, membership and chains', () => {
  it.each([
    [
      'a | b ^ c & d << e >> f',
      '(Binary a | (Binary b ^ (Binary c & (Binary (Binary d << e) >> f))))',
    ],
    ['a + b << c', '(Binary (Binary a + b) << c)'],
    ['0..1 << k', '(Range 0 (Binary 1 << k) _)'],
    ['a | b..c', '(Range (Binary a | b) c _)'],
    ['2 ** 3 ** 2', '(Binary 2 ** (Binary 3 ** 2))'],
    ['2 ** -1', '(Binary 2 ** (Unary - 1))'],
    ['-(2 ** 2)', '(Unary - (Parenthesized (Binary 2 ** 2)))'],
    ['(-2) ** 2', '(Binary (Parenthesized (Unary - 2)) ** 2)'],
    ['not a ** b', '(Unary not (Binary a ** b))'],
    ['**x', '(Dereference * (Dereference * x))'],
    ['~a & b', '(Binary (Unary ~ a) & b)'],
    ['x in xs', '(Binary x in xs)'],
    ['x not in xs and y', '(Binary (Binary x not in xs) and y)'],
    ['a < b <= c', '(ChainedComparison [a b c] [< <=])'],
    ['(a < b) <= c', '(Binary (Parenthesized (Binary a < b)) <= c)'],
    ['a < b in c', '(ChainedComparison [a b c] [< in])'],
    ['a in b not in c', '(ChainedComparison [a b c] [in not in])'],
    ['0..10 by 2', '(Range 0 10 2)'],
    ['..10 by 2', '(Range _ 10 2)'],
    ['0.. by 2', '(Range 0 _ 2)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});
