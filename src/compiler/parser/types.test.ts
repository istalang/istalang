/**
 * Type grammar: every type form, trailing commas and line breaks inside brackets, `&T` only in a
 * parameter's type, and one diagnostic per malformed type.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { dumpClean, dumpOf, field, int, named, parseAs, reported } from './parse.test-kit.ts';

const { expected, misplacedReference, unclosedBracket } = parserDiagnostics;

describe('type forms', () => {
  it.each([
    ['Int', int],
    ['Self', named('Self')],
    ['Pair<A, B>', `(NamedType [Pair] [${named('A')} ${named('B')}])`],
    ['Map<K, V,>', `(NamedType [Map] [${named('K')} ${named('V')}])`],
    ['time.Duration', '(NamedType [time Duration] [])'],
    ['Array<Array<Int>>', `(NamedType [Array] [(NamedType [Array] [${int}])])`],
    ['T?', `(OptionalType ${named('T')})`],
    ['T??', `(OptionalType (OptionalType ${named('T')}))`],
    ['Future<Unit>?', `(OptionalType (NamedType [Future] [${named('Unit')}]))`],
    ['(A, B)', `(TupleType [${named('A')} ${named('B')}])`],
    ['(A,)', `(TupleType [${named('A')}])`],
    ['()', '(TupleType [])'],
    ['(A)', `(ParenthesizedType ${named('A')})`],
    ['fn(A, B) -> R', `(FunctionType [${named('A')} ${named('B')}] ${named('R')})`],
    ['async fn(A) -> R', `(FunctionType isAsync [${named('A')}] ${named('R')})`],
    [
      'async fn(async fn(E))',
      `(FunctionType isAsync [(FunctionType isAsync [${named('E')}] _)] _)`,
    ],
    ['fn() -> Int?', `(FunctionType [] (OptionalType ${int}))`],
    ['(fn() -> Int)?', `(OptionalType (ParenthesizedType (FunctionType [] ${int})))`],
    ['fn(&Array<Int>)', `(FunctionType [(ReferenceType (NamedType [Array] [${int}]))] _)`],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('type', text)).toBe(tree);
  });
});

describe('anonymous struct types', () => {
  const skuQty = `(StructType [${field('sku', named('String'))} ${field('qty', int)}])`;

  it.each([
    '{ sku: String; qty: Int }',
    'struct { sku: String; qty: Int }',
    '{ sku: String; qty: Int; }',
    '{\n  sku: String\n  qty: Int\n}',
    '{\n  sku: String;\n\n  qty: Int\n}',
  ])('parses %j, separated by semicolons or line breaks (§2)', (text) => {
    expect(dumpClean('type', text)).toBe(skuQty);
  });

  it('parses an empty struct and one nested in type arguments', () => {
    expect(dumpClean('type', '{}')).toBe('(StructType [])');
    expect(dumpClean('type', 'Array<{ sku: String; qty: Int }>')).toBe(
      `(NamedType [Array] [${skuQty}])`,
    );
  });
});

describe('references (§3.7)', () => {
  it("allows '&T' as a parameter's type", () => {
    expect(dumpClean('parameterType', '&Stack<T>')).toBe(
      `(ReferenceType (NamedType [Stack] [${named('T')}]))`,
    );
  });

  it("reports '&T' anywhere else", () => {
    expect(reported('type', '&Int')).toEqual(reportedOnce(misplacedReference.code, '&Int'));
  });
});

describe('malformed types', () => {
  it.each([
    [',', expected.code, ','],
    ['Map<String, int', unclosedBracket.code, '<'],
    ['{ a Int }', expected.code, 'Int'],
    ['{ a: Int b: Int }', expected.code, 'b'],
    ['fn Int', expected.code, 'Int'],
    ['struct', expected.code, ''],
    ['(A, B', unclosedBracket.code, '('],
  ])('reports %j once', (text, code, spanText) => {
    expect(reported('type', text)).toEqual(reportedOnce(code, spanText));
  });
});

describe('a qualified type still being written', () => {
  it('ends its path in a missing name after the dot, reported once', () => {
    expect(dumpOf(parseAs('type', 'time.'))).toBe('(NamedType [time <missing name>] [])');
    expect(reported('type', 'time.')).toEqual(reportedOnce(expected.code, ''));
  });
});

describe('`any` and rest parameters', () => {
  it.each([
    ['any Notifier', `(AnyType [${named('Notifier')}])`],
    ['any A & B?', `(OptionalType (AnyType [${named('A')} ${named('B')}]))`],
    ['any', named('any')],
    [
      'fn(Int, ...Array<String>) -> R',
      `(FunctionType [${int} (RestType (NamedType [Array] [${named('String')}]))] ${named('R')})`,
    ],
    ['fn(...A) -> R', `(FunctionType [(RestType ${named('A')})] ${named('R')})`],
    [
      'Map<K, Array<Array<Int>>>',
      `(NamedType [Map] [${named('K')} (NamedType [Array] [(NamedType [Array] [${int}])])])`,
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('type', text)).toBe(tree);
  });
});
