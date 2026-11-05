/**
 * Pattern grammar (§3.11): every pattern form, every field test, `as` on a field and on a whole
 * pattern, and one diagnostic per malformed pattern.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { dumpClean, named, parseAs, reported } from './parse.test-kit.ts';

const { expected, unclosedBracket } = parserDiagnostics;

describe('pattern forms', () => {
  it.each([
    ['0', '(LiteralPattern 0)'],
    ['"cfo"', '(LiteralPattern "cfo")'],
    ['-1', '(LiteralPattern (Unary - 1))'],
    ['-2.5', '(LiteralPattern (Unary - 2.5))'],
    ['true', '(LiteralPattern true)'],
    ['none', '(LiteralPattern none)'],
    ['5d', '(LiteralPattern 432000000ms)'],
    ['_', '(WildcardPattern)'],
    ['Expired', '(NamePattern [Expired] [])'],
    ['Decision.Expired', '(NamePattern [Decision Expired] [])'],
    ['(a, _)', '(TuplePattern [(NamePattern [a] []) (WildcardPattern)])'],
    ['(a, _,)', '(TuplePattern [(NamePattern [a] []) (WildcardPattern)])'],
    ['()', '(TuplePattern [])'],
    ['(a)', '(ParenthesizedPattern (NamePattern [a] []))'],
    ['Expired as e', '(AsPattern (NamePattern [Expired] []) e)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('pattern', text)).toBe(tree);
  });
});

describe('struct patterns', () => {
  it.each([
    ['Approved{by}', `(StructPattern ${named('Approved')} [(BindFieldPattern by _)] _)`],
    [
      'Rejected{reason as why}',
      `(StructPattern ${named('Rejected')} [(BindFieldPattern reason why)] _)`,
    ],
    [
      'Verdict{ok == false}',
      `(StructPattern ${named('Verdict')} [(CompareFieldPattern ok == false)] _)`,
    ],
    [
      'Order{amount > 1000}',
      `(StructPattern ${named('Order')} [(CompareFieldPattern amount > 1000)] _)`,
    ],
    [
      'Order{amount >= base * 2}',
      `(StructPattern ${named('Order')} [(CompareFieldPattern amount >= (Binary base * 2))] _)`,
    ],
    [
      'Some{value is Verdict{ok == false} as v}',
      `(StructPattern ${named('Some')} [(NestedFieldPattern value (AsPattern (StructPattern ${named('Verdict')} [(CompareFieldPattern ok == false)] _) v))] _)`,
    ],
    [
      'Verdict{ok == false} as v',
      `(AsPattern (StructPattern ${named('Verdict')} [(CompareFieldPattern ok == false)] _) v)`,
    ],
    ['struct{a, b}', '(StructPattern _ [(BindFieldPattern a _) (BindFieldPattern b _)] _)'],
    ['m.Pair{first,}', '(StructPattern (NamedType [m Pair] []) [(BindFieldPattern first _)] _)'],
    [
      'Pair{\n  first,\n  second\n}',
      `(StructPattern ${named('Pair')} [(BindFieldPattern first _) (BindFieldPattern second _)] _)`,
    ],
    ['Ok{}', `(StructPattern ${named('Ok')} [] _)`],
  ])('parses %j', (text, tree) => {
    expect(dumpClean('pattern', text)).toBe(tree);
  });
});

describe('patterns naming a generic type with its type arguments (§3.11)', () => {
  const settingsRegion = `[${named('Settings')} (LiteralType "region")]`;

  it.each([
    [
      'Entry<Settings, "region">{value}',
      `(StructPattern (NamedType [Entry] ${settingsRegion}) [(BindFieldPattern value _)] _)`,
    ],
    ['Entry<Settings, "region"> as e', `(AsPattern (NamePattern [Entry] ${settingsRegion}) e)`],
    ['m.Box<Int | None>', `(NamePattern [m Box] [(UnionType [${named('Int')} ${named('None')}])])`],
    [
      'Box<Int> | Box<String>',
      `(OrPattern [(NamePattern [Box] [${named('Int')}]) (NamePattern [Box] [${named('String')}])])`,
    ],
  ])('parses %j', (text, tree) => {
    expect(dumpClean('pattern', text)).toBe(tree);
  });

  it('leaves a `<` whose contents are no types to what holds the pattern', () => {
    expect(dumpClean('expression', 'x is P < y')).toBe('(Binary (Is x (NamePattern [P] [])) < y)');
    expect(parseAs('pattern', 'P < 1.5').rest).toBe(2);
  });
});

describe('malformed patterns', () => {
  it.each([
    ['+', '+'],
    ['Foo{42}', '42'],
    ['Foo{a b}', 'b'],
    ['Foo{a == }', '}'],
    ['-x', 'x'],
    ['x as', ''],
    ['struct', ''],
  ])('reports %j once, as an expected token', (text, spanText) => {
    expect(reported('pattern', text)).toEqual(reportedOnce(expected.code, spanText));
  });

  it('reports an unclosed struct pattern at its brace', () => {
    expect(reported('pattern', 'Foo{a, b')).toEqual(reportedOnce(unclosedBracket.code, '{'));
  });
});

describe('or, array and range patterns', () => {
  it.each([
    ['A | B as x', '(AsPattern (OrPattern [(NamePattern [A] []) (NamePattern [B] [])]) x)'],
    [
      '[first, ...rest, last]',
      '(ArrayPattern [(NamePattern [first] []) (RestPattern rest) (NamePattern [last] [])])',
    ],
    ['[..._]', '(ArrayPattern [(RestPattern (WildcardPattern))])'],
    ['1..=5', '(RangePattern (LiteralPattern 1) isInclusive (LiteralPattern 5))'],
    ['..5', '(RangePattern _ (LiteralPattern 5))'],
    ['5..', '(RangePattern (LiteralPattern 5) _)'],
    ['-3..=3', '(RangePattern (LiteralPattern (Unary - 3)) isInclusive (LiteralPattern 3))'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('pattern', text)).toBe(tree);
  });

  it('reports a range bound that is not a literal', () => {
    expect(reported('pattern', 'a..=5')).toEqual(
      reportedOnce(parserDiagnostics.rangeBound.code, 'a'),
    );
  });
});
