/**
 * ',' as the one list separator, with ';' only between statements (proposal 5 §4, note 8):
 * every list in §4's table parses with ',', statements keep ';', destructuring targets keep ',',
 * match/select/type-match cases stand one per line, and ';' in a list or ',' between statements
 * reports a diagnostic naming the right separator.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from './diagnostics.ts';
import {
  declaredField,
  dumpClean,
  field,
  int,
  lines,
  moduleOf,
  named,
  parseAs,
  reported,
} from './parse.test-kit.ts';

const string = named('String');
const float = named('Float');

describe('every list in §4 separates its items with ","', () => {
  it.each([
    [
      'anonymous struct type { sku: String, qty: Int }',
      'type' as const,
      '{ sku: String, qty: Int }',
      `(StructType [${field('sku', string)} ${field('qty', int)}])`,
    ],
    [
      'struct declaration in braces: struct Req { id: Int, value: String }',
      'module' as const,
      'struct Req { id: Int, value: String }',
      moduleOf(
        `(StructDeclaration Req [] [${declaredField('id', int)} ${declaredField('value', string)}] [])`,
      ),
    ],
    [
      'struct declaration with defaults in braces: struct Retry { times: Int = 3, backoff = times * 2 }',
      'module' as const,
      'struct Retry { times: Int = 3, backoff = times * 2 }',
      moduleOf(
        `(StructDeclaration Retry [] [${declaredField('times', int, '3')} ${declaredField('backoff', '_', '(Binary times * 2)')}] [])`,
      ),
    ],
    [
      'struct declaration with associated type in braces: struct Cell<T> { value: T, type Data = Array<T> }',
      'module' as const,
      'struct Cell<T> { value: T, type Data = Array<T> }',
      moduleOf(
        `(StructDeclaration Cell [(TypeParameter T _ [] _)] [${declaredField('value', named('T'))}] [(AssociatedType Data (NamedType [Array] [${named('T')}]))])`,
      ),
    ],
    [
      'enum declaration in braces: enum Color { Red, Green, Blue }',
      'module' as const,
      'enum Color { Red, Green, Blue }',
      moduleOf(
        '(EnumDeclaration Color [] [(Variant Red []) (Variant Green []) (Variant Blue [])] [])',
      ),
    ],
    [
      'variant fields in braces: Rejected { by: String, reason: String }',
      'module' as const,
      'enum Decision { Rejected { by: String, reason: String }, Expired }',
      moduleOf(
        `(EnumDeclaration Decision [] [(Variant Rejected [${declaredField('by', string)} ${declaredField('reason', string)}]) (Variant Expired [])] [])`,
      ),
    ],
    [
      'trait members in braces: trait Shape { fn area(self: Self) -> Float, type Unit }',
      'module' as const,
      'trait Shape { fn area(self: Self) -> Float, type Unit }',
      moduleOf(
        `(TraitDeclaration Shape [] [(FunctionDeclaration _ area [] [(Parameter self ${named('Self')} _)] ${float} _) (RequiredAssociatedType Unit [])])`,
      ),
    ],
    [
      'struct constraint entries: struct { title: String, [_] is Stringable }',
      'module' as const,
      'fn f<S is struct { title: String, [_] is Stringable }>(s: S): ()',
      moduleOf(
        `(FunctionDeclaration _ f [(TypeParameter S _ [(StructConstraint [(FieldTypeEntry title ${string}) (FieldConstraintEntry (OtherFields) [${named('Stringable')}])])] _)] [(Parameter s ${named('S')} _)] _ (Block [(ExpressionStatement (Tuple []))]))`,
      ),
    ],
    [
      'mapped struct type entries: { id: String, [F in keyof S]: S[F].Data }',
      'type' as const,
      '{ id: String, [F in keyof S]: S[F].Data }',
      `(StructType [${field('id', string)} (MappedField (TypeParameter F (KeyofType ${named('S')}) [] _) (MemberType (IndexedType ${named('S')} ${named('F')}) Data))])`,
    ],
    [
      'fields, variants and trait members on one line of an indented body',
      'module' as const,
      lines(
        'struct Req:',
        '  id: Int, value: String',
        'enum Color:',
        '  Red, Green, Blue',
        'trait Shape:',
        '  fn area(self: Self) -> Float, type Unit',
      ),
      moduleOf(
        `(StructDeclaration Req [] [${declaredField('id', int)} ${declaredField('value', string)}] [])`,
        '(EnumDeclaration Color [] [(Variant Red []) (Variant Green []) (Variant Blue [])] [])',
        `(TraitDeclaration Shape [] [(FunctionDeclaration _ area [] [(Parameter self ${named('Self')} _)] ${float} _) (RequiredAssociatedType Unit [])])`,
      ),
    ],
  ])('parses %s', (_name, category, text, expectedTree) => {
    expect(dumpClean(category, text)).toBe(expectedTree);
  });
});

describe('statements keep ";" and destructuring targets keep "," (§4)', () => {
  it.each([
    ['two assignments sharing a line with ";"', 'fn f():\n  x = 1; y = 2'],
    ['a one-line block expression with ";"', 'fn f(): { log(msg); save(msg) }'],
    [
      'a lambda with a one-line block body separated by ";"',
      'const g = fn(msg): { log(msg); save(msg); msg.id }',
    ],
    ['top-level declarations sharing a line with ";"', 'struct A; struct B'],
    [
      'tuple assignment a, b = (b, a) and multi-target let a, b = t',
      lines('fn f(t: (Int, Int)):', '  let a, b = t', '  a, b = (b, a)'),
    ],
  ])('parses %s without diagnostics', (_name, text) => {
    expect(reported('module', text).codes).toEqual([]);
  });
});

describe('match, select and type match cases stand one per line (§4)', () => {
  it.each([
    [
      'match cases on one line with ";"',
      lines('fn f(x: Int) -> Int:', '  match x:', '    case 1: 10; case _: 20'),
    ],
    [
      'match cases on one line with ","',
      lines('fn f(x: Int) -> Int:', '  match x:', '    case 1: 10, case _: 20'),
    ],
    [
      'select cases on one line with ";"',
      lines(
        'async fn f(a: Future<Int>, b: Future<Int>) -> Future<Int>:',
        '  await select:',
        '    case a as x: x; case b as y: y',
      ),
    ],
    [
      'type match cases on one line with ","',
      lines('type Out<T> = match T:', '  case Int: String, case _: Bool'),
    ],
    [
      'type match cases on one line with ";"',
      lines('type Out<T> = match T:', '  case Int: String; case _: Bool'),
    ],
  ])('rejects %s', (_name, text) => {
    expect(reported('module', text).codes.length).toBeGreaterThan(0);
  });
});

describe('";" between list items and "," between statements are errors (§4, note 8)', () => {
  it.each([
    ['anonymous struct type', 'type' as const, '{ sku: String; qty: Int }'],
    ['struct declaration in braces', 'module' as const, 'struct Req { id: Int; value: String }'],
    [
      'struct declaration indented on one line',
      'module' as const,
      'struct Req:\n  id: Int; value: String',
    ],
    ['enum variants in braces', 'module' as const, 'enum Color { Red; Green; Blue }'],
    ['enum variants indented on one line', 'module' as const, 'enum Color:\n  Red; Green'],
    ['variant fields in braces', 'module' as const, 'enum E { V { a: Int; b: String } }'],
    [
      'trait members in braces',
      'module' as const,
      'trait T { fn a(self: Self); fn b(self: Self) }',
    ],
    [
      'struct constraint entries',
      'module' as const,
      'fn f<S is struct { title: String; [_] is Sendable }>(s: S): ()',
    ],
    ['mapped struct type entries', 'type' as const, '{ id: String; [F in keyof S]: S[F] }'],
    ['array literal', 'expression' as const, '[1; 2]'],
    ['struct literal', 'expression' as const, 'Pair{first: 1; second: 2}'],
    ['call arguments', 'expression' as const, 'f(1; 2)'],
  ])('reports ";" in %s, naming "," as the separator', (_name, category, text) => {
    const parsed = parseAs(category, text);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(reported(category, text).spanTexts).toContain(';');
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("','"))).toBe(true);
  });

  it.each([
    ['two call statements on one line in a block', lines('fn f():', '  first(), second()')],
    ['two statements in a one-line braced block', 'fn f(): { first(), second() }'],
    ['two variable declarations on one line', lines('fn f():', '  const a = 1, const b = 2')],
  ])('reports "," between statements in %s, naming ";" as the separator', (_name, text) => {
    const parsed = parseAs('module', text);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(reported('module', text).spanTexts).toContain(',');
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.message.includes("';'"))).toBe(true);
  });

  it('keeps semicolonAfterInlineBody (2011) and blockWithoutSemicolon (2012)', () => {
    expect(reported('statement', 'if urgent: alert(msg); save(msg)')).toEqual(
      reportedOnce(parserDiagnostics.semicolonAfterInlineBody.code, ';'),
    );
    expect(reported('expression', '{ alert(msg) }')).toEqual(
      reportedOnce(parserDiagnostics.blockWithoutSemicolon.code, '{ alert(msg) }'),
    );
  });
});
