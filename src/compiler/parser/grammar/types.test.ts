/**
 * Type grammar: every type form, trailing commas and line breaks inside brackets, `&T` only in a
 * parameter's type, the levels `|` binds between, and one diagnostic per malformed type.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../foundation/diagnostics/diagnostic.test-kit.ts';
import type { TypeNode } from '../../syntax/types/index.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { dumpClean, dumpOf, field, int, named, parseAs, reported } from '../parse.test-kit.ts';
import { printType, typeShapeOf, typeTree } from './type-precedence.test-kit.ts';

const {
  constraintEntryInType,
  expected,
  misplacedReference,
  structConstraintAfterAny,
  unclosedBracket,
} = parserDiagnostics;

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
    ['async fn(A) -> R', `(FunctionType async [${named('A')}] ${named('R')})`],
    ['async fn(async fn(E))', `(FunctionType async [(FunctionType async [${named('E')}] _)] _)`],
    ['fn() -> Int?', `(FunctionType [] (OptionalType ${int}))`],
    ['(fn() -> Int)?', `(OptionalType (ParenthesizedType (FunctionType [] ${int})))`],
    ['fn(&Array<Int>)', `(FunctionType [(ReferenceType (NamedType [Array] [${int}]))] _)`],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('type', text)).toBe(tree);
  });
});

describe('union types', () => {
  const [a, b, c] = [named('A'), named('B'), named('C')];

  it.each([
    ['A | B', `(UnionType [${a} ${b}])`],
    ['A | B | C', `(UnionType [${a} ${b} ${c}])`],
    ['A | B?', `(UnionType [${a} (OptionalType ${b})])`],
    ['A? | B', `(UnionType [(OptionalType ${a}) ${b}])`],
    ['(A | B)?', `(OptionalType (ParenthesizedType (UnionType [${a} ${b}])))`],
    ['A | (B | C)', `(UnionType [${a} (ParenthesizedType (UnionType [${b} ${c}]))])`],
    ['Array<A | B>', `(NamedType [Array] [(UnionType [${a} ${b}])])`],
    ['(A | B, C)', `(TupleType [(UnionType [${a} ${b}]) ${c}])`],
  ])('reads %s, `|` binding looser than `?` and type arguments', (text, tree) => {
    expect(dumpClean('type', text)).toBe(tree);
  });

  it.each([
    ['fn() -> A | B', `(FunctionType [] (UnionType [${a} ${b}]))`],
    ['(fn() -> A) | B', `(UnionType [(ParenthesizedType (FunctionType [] ${a})) ${b}])`],
    ['fn(A | B) -> C', `(FunctionType [(UnionType [${a} ${b}])] ${c})`],
    ['any A & B | C', `(UnionType [(AnyType [${a} ${b}]) ${c}])`],
    ['any A | B', `(UnionType [(AnyType [${a}]) ${b}])`],
  ])("reads %s, `|` binding tighter than a function type's `->` (§1)", (text, tree) => {
    expect(dumpClean('type', text)).toBe(tree);
  });

  it('parses unions, literal types, optionals, function types and type arguments, written with the fewest parentheses, back to the tree they were written from', () => {
    fc.assert(
      fc.property(typeTree, (tree) => {
        const parsed = parseAs('type', printType(tree));
        expect({
          shape: typeShapeOf(parsed.node as TypeNode),
          problems: [...parsed.diagnostics.map(({ message }) => message), parsed.rest],
        }).toEqual({ shape: tree, problems: [0] });
      }),
      { numRuns: 500 },
    );
  });

  it.each([
    ['A |', ''],
    ['A | | B', '|'],
    ['| A', '|'],
  ])('reports %j once, a member missing', (text, spanText) => {
    expect(reported('type', text)).toEqual(reportedOnce(expected.code, spanText));
  });
});

describe('literal types', () => {
  it.each([
    ['"draft"', '(LiteralType "draft")'],
    ['42', '(LiteralType 42)'],
    ['-1', '(LiteralType (Unary - 1))'],
    ['true', '(LiteralType true)'],
    ['false', '(LiteralType false)'],
    [
      '"draft" | "sent" | -1',
      '(UnionType [(LiteralType "draft") (LiteralType "sent") (LiteralType (Unary - 1))])',
    ],
    ['Entry<S, "region">', `(NamedType [Entry] [${named('S')} (LiteralType "region")])`],
    ['"a"?', '(OptionalType (LiteralType "a"))'],
  ])('reads %s', (text, tree) => {
    expect(dumpClean('type', text)).toBe(tree);
  });

  it.each([
    ['1.5', '1.5'],
    ['5d', '5d'],
    ['none', 'none'],
    ['-1.5', '1.5'],
    ['-x', 'x'],
    ['`t`', '`t`'],
  ])('reports %j once: only a string, an integer or a bool is a type (§4.3)', (text, spanText) => {
    expect(reported('type', text)).toEqual(reportedOnce(expected.code, spanText));
  });
});

describe('anonymous struct types', () => {
  const skuQty = `(StructType [${field('sku', named('String'))} ${field('qty', int)}])`;

  it.each([
    '{ sku: String, qty: Int }',
    'struct { sku: String, qty: Int }',
    '{ sku: String, qty: Int, }',
    '{\n  sku: String\n  qty: Int\n}',
    '{\n  sku: String,\n\n  qty: Int\n}',
  ])('parses %j, separated by semicolons or line breaks (§2.1)', (text) => {
    expect(dumpClean('type', text)).toBe(skuQty);
  });

  it('parses an empty struct and one nested in type arguments', () => {
    expect(dumpClean('type', '{}')).toBe('(StructType [])');
    expect(dumpClean('type', 'Array<{ sku: String, qty: Int }>')).toBe(
      `(NamedType [Array] [${skuQty}])`,
    );
  });
});

describe('references (§7.3)', () => {
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

describe('a struct constraint where a type stands (§8.1)', () => {
  it.each([
    ['struct { [_]: Int }', '[_]: Int'],
    ['{ a: Int, [_] is X & Y }', '[_] is X & Y'],
    ['struct { a is Stringable }', 'a is Stringable'],
    ['{ a is struct { [_]: Int } }', 'a is struct { [_]: Int }'],
  ])('reports the entry of %j once, keeping the fields beside it', (text, spanText) => {
    expect(reported('type', text)).toEqual(reportedOnce(constraintEntryInType.code, spanText));
  });

  it("reports one after 'any' once", () => {
    expect(reported('type', 'any struct { a: Int }')).toEqual(
      reportedOnce(structConstraintAfterAny.code, 'struct { a: Int }'),
    );
    expect(dumpOf(parseAs('type', '{ a: Int, [_]: Int }'))).toBe(
      `(StructType [${field('a', int)} !])`,
    );
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
