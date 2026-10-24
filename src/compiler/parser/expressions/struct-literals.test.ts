/**
 * Struct literals (§3.1): every item form, `struct{…}`, qualified and generic types (§3.5), the
 * brace rule after any name (§2), and the positional-value rule.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { dump } from '../../syntax/tree.test-kit.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { dumpClean, named, parseAs, reported } from '../parse.test-kit.ts';

const literal = (type: string, items: string) => `(StructLiteral ${type} [${items}])`;

describe('struct literal items', () => {
  it.each([
    [
      'Pair{first: 1, second: 2}',
      literal(named('Pair'), '(FieldInitializer first 1) (FieldInitializer second 2)'),
    ],
    [
      'Pair{first, second}',
      literal(named('Pair'), '(FieldInitializer first _) (FieldInitializer second _)'),
    ],
    ['UserId{id}', literal(named('UserId'), '(FieldInitializer id _)')],
    ['Ok{42}', literal(named('Ok'), '(PositionalInitializer 42)')],
    ['Ok{(receipt)}', literal(named('Ok'), '(PositionalInitializer (Parenthesized receipt))')],
    ['UserId{"u-1"}', literal(named('UserId'), '(PositionalInitializer "u-1")')],
    [
      'UserId{prefix + id}',
      literal(named('UserId'), '(PositionalInitializer (Binary prefix + id))'),
    ],
    [
      'Req{...req, value: "new"}',
      literal(named('Req'), '(Spread req) (FieldInitializer value "new")'),
    ],
    ['Ok{}', literal(named('Ok'), '')],
    ['struct{value: 1}', literal('_', '(FieldInitializer value 1)')],
    ['struct{...req, amount: 0}', literal('_', '(Spread req) (FieldInitializer amount 0)')],
    [
      'Pair{first: 1, second: 2,}',
      literal(named('Pair'), '(FieldInitializer first 1) (FieldInitializer second 2)'),
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it('parses a multi-line literal with nested anonymous literals and a trailing comma', () => {
    const text =
      'Response{\n  id: "x",\n  data: struct{value, result: "ok"},\n  items: [struct{sku: "a", qty: 2}],\n}';
    expect(dumpClean('expression', text)).toBe(
      literal(
        named('Response'),
        [
          '(FieldInitializer id "x")',
          `(FieldInitializer data ${literal('_', '(FieldInitializer value _) (FieldInitializer result "ok")')})`,
          `(FieldInitializer items (ArrayLiteral [${literal('_', '(FieldInitializer sku "a") (FieldInitializer qty 2)')}]))`,
        ].join(' '),
      ),
    );
  });

  it('reports a positional value that is not alone, at the value', () => {
    expect(reported('expression', 'Ok{1, other: 2}')).toEqual(
      reportedOnce(parserDiagnostics.positionalNotAlone.code, '1'),
    );
  });
});

describe('the type before the braces', () => {
  it.each([
    ['m.Pair{a: 1}', literal('(NamedType [m Pair] [])', '(FieldInitializer a 1)')],
    ['Decision.Expired{}', literal('(NamedType [Decision Expired] [])', '')],
    [
      'Pair<int, string>{first: 1}',
      literal(
        `(NamedType [Pair] [${named('int')} ${named('string')}])`,
        '(FieldInitializer first 1)',
      ),
    ],
    ['pair{a: 1}', literal(named('pair'), '(FieldInitializer a 1)')],
  ])('parses %s (§3.5, §2)', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it.each(['f(){a: 1}', 'xs[0]{a: 1}', 'a?.b{c: 1}', '1{a: 1}'])(
    'leaves the braces after %s, which is not a name (§2)',
    (text) => {
      const parsed = parseAs('expression', text);
      expect(dump(parsed.node)).not.toContain('StructLiteral');
      expect(parsed.rest).toBeGreaterThan(0);
    },
  );

  it("reports 'struct' without braces", () => {
    expect(reported('expression', 'struct')).toEqual(
      reportedOnce(parserDiagnostics.expected.code, ''),
    );
  });
});
