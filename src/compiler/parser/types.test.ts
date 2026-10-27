/**
 * Type grammar: every type form, trailing commas and line breaks inside brackets, `&T` only in a
 * parameter's type, and one diagnostic per malformed type.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { dumpClean, field, int, named, reported } from './parse.test-kit.ts';

const { expected, misplacedReference, unclosedBracket } = parserDiagnostics;

describe('type forms', () => {
  it.each([
    ['int', int],
    ['Self', named('Self')],
    ['Pair<A, B>', `(NamedType [Pair] [${named('A')} ${named('B')}])`],
    ['Map<K, V,>', `(NamedType [Map] [${named('K')} ${named('V')}])`],
    ['time.Duration', '(NamedType [time Duration] [])'],
    ['Array<Array<int>>', `(NamedType [Array] [(NamedType [Array] [${int}])])`],
    ['T?', `(OptionalType ${named('T')})`],
    ['T??', `(OptionalType (OptionalType ${named('T')}))`],
    ['Future<unit>?', `(OptionalType (NamedType [Future] [${named('unit')}]))`],
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
    ['fn() -> int?', `(FunctionType [] (OptionalType ${int}))`],
    ['(fn() -> int)?', `(OptionalType (ParenthesizedType (FunctionType [] ${int})))`],
    ['fn(&Array<int>)', `(FunctionType [(ReferenceType (NamedType [Array] [${int}]))] _)`],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('type', text)).toBe(tree);
  });
});

describe('anonymous struct types', () => {
  const skuQty = `(StructType [${field('sku', named('string'))} ${field('qty', int)}])`;

  it.each([
    '{ sku: string; qty: int }',
    'struct { sku: string; qty: int }',
    '{ sku: string; qty: int; }',
    '{\n  sku: string\n  qty: int\n}',
    '{\n  sku: string;\n\n  qty: int\n}',
  ])('parses %j, separated by semicolons or line breaks (§2)', (text) => {
    expect(dumpClean('type', text)).toBe(skuQty);
  });

  it('parses an empty struct and one nested in type arguments', () => {
    expect(dumpClean('type', '{}')).toBe('(StructType [])');
    expect(dumpClean('type', 'Array<{ sku: string; qty: int }>')).toBe(
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
    expect(reported('type', '&int')).toEqual(reportedOnce(misplacedReference.code, '&int'));
  });
});

describe('malformed types', () => {
  it.each([
    [',', expected.code, ','],
    ['Map<string, int', unclosedBracket.code, '<'],
    ['{ a int }', expected.code, 'int'],
    ['{ a: int b: int }', expected.code, 'b'],
    ['fn int', expected.code, 'int'],
    ['struct', expected.code, ''],
    ['(A, B', unclosedBracket.code, '('],
  ])('reports %j once', (text, code, spanText) => {
    expect(reported('type', text)).toEqual(reportedOnce(code, spanText));
  });
});

describe('`any` and rest parameters', () => {
  it.each([
    ['any Notifier', `(AnyType [${named('Notifier')}])`],
    ['any A & B?', `(OptionalType (AnyType [${named('A')} ${named('B')}]))`],
    ['any', named('any')],
    [
      'fn(int, ...Array<string>) -> R',
      `(FunctionType [${int} (RestType (NamedType [Array] [${named('string')}]))] ${named('R')})`,
    ],
    ['fn(...A) -> R', `(FunctionType [(RestType ${named('A')})] ${named('R')})`],
    [
      'Map<K, Array<Array<int>>>',
      `(NamedType [Map] [${named('K')} (NamedType [Array] [(NamedType [Array] [${int}])])])`,
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('type', text)).toBe(tree);
  });
});
