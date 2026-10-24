/**
 * Literals, names, parentheses, tuples and bracket literals (§2, §4), including trailing commas
 * (G12) and line breaks inside brackets (G13).
 */

import { describe, expect, it } from 'vitest';
import { parserDiagnostics } from '../diagnostics.ts';
import { dumpClean, reported, reportedOnce } from '../parse.test-kit.ts';

describe('literals and names', () => {
  it.each([
    ['42', '42'],
    ['1_000', '1000'],
    ['0x1F', '31'],
    ['0b1010', '10'],
    ['3.14', '3.14'],
    ['1e9', '1000000000'],
    ['5d', '432000000ms'],
    ['30s', '30000ms'],
    ['"text"', '"text"'],
    ["'text'", '"text"'],
    ['true', 'true'],
    ['false', 'false'],
    ['none', 'none'],
    ['userId', 'userId'],
    ['type', 'type'],
    ['from', 'from'],
    ['Self', 'Self'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});

describe('parentheses and tuples', () => {
  it.each([
    ['(1, "x")', '(Tuple [1 "x"])'],
    ['()', '(Tuple [])'],
    ['(x,)', '(Tuple [x])'],
    ['(x)', '(Parenthesized x)'],
    ['((x))', '(Parenthesized (Parenthesized x))'],
    ['(\n  a,\n  b,\n)', '(Tuple [a b])'],
  ])('parses %j', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});

describe('arrays and maps', () => {
  it.each([
    ['[1, 2]', '(ArrayLiteral [1 2])'],
    ['[1, 2,]', '(ArrayLiteral [1 2])'],
    ['[]', '(ArrayLiteral [])'],
    ['[...xs, 3]', '(ArrayLiteral [(Spread xs) 3])'],
    ['[...m]', '(ArrayLiteral [(Spread m)])'],
    ['["a": 1]', '(MapLiteral [(MapEntry "a" 1)])'],
    ['["legal": 1, "cfo": 2,]', '(MapLiteral [(MapEntry "legal" 1) (MapEntry "cfo" 2)])'],
    ['[:]', '(MapLiteral [])'],
    ['[ : ]', '(MapLiteral [])'],
    ['[...m, "a": 2]', '(MapLiteral [(Spread m) (MapEntry "a" 2)])'],
    ['[k + 1: v]', '(MapLiteral [(MapEntry (Binary k + 1) v)])'],
    ['[\n  1,\n  2\n]', '(ArrayLiteral [1 2])'],
  ])('parses %j', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it('reports a map literal that mixes in a plain element, at the element', () => {
    expect(reported('expression', '["a": 1, 2]')).toEqual(
      reportedOnce(parserDiagnostics.mixedCollection.code, '2'),
    );
  });
});

describe('comprehensions', () => {
  it.each([
    ['[for i in 1..10: 5 * i]', '(Comprehension [i] (Range 1 10) _ (Binary 5 * i))'],
    ['[for x in xs if x < 20: x * 2]', '(Comprehension [x] xs (Binary x < 20) (Binary x * 2))'],
    ['[for k, v in m: k]', '(Comprehension [k v] m _ k)'],
    [
      '[for r in results if r is Ok{value}: value]',
      '(Comprehension [r] results (Is r (StructPattern (NamedType [Ok] []) [(BindFieldPattern value _)])) value)',
    ],
    ['[\n  for x in xs:\n    x\n]', '(Comprehension [x] xs _ x)'],
  ])('parses %j', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it.each([
    ['[for x xs: x]', 'xs'],
    ['[for x in xs x]', 'x'],
  ])('reports the missing keyword or colon in %j once', (text, spanText) => {
    expect(reported('expression', text)).toEqual(
      reportedOnce(parserDiagnostics.expected.code, spanText),
    );
  });
});
