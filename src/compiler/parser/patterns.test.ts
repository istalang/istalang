/**
 * Pattern grammar (§3.11): every pattern form, every field test, `as` on a field and on a whole
 * pattern, and one diagnostic per malformed pattern.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { dumpClean, named, reported } from './parse.test-kit.ts';

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
    ['Expired', '(NamePattern [Expired])'],
    ['Decision.Expired', '(NamePattern [Decision Expired])'],
    ['(a, _)', '(TuplePattern [(NamePattern [a]) (WildcardPattern)])'],
    ['(a, _,)', '(TuplePattern [(NamePattern [a]) (WildcardPattern)])'],
    ['()', '(TuplePattern [])'],
    ['(a)', '(ParenthesizedPattern (NamePattern [a]))'],
    ['Expired as e', '(AsPattern (NamePattern [Expired]) e)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('pattern', text)).toBe(tree);
  });
});

describe('struct patterns', () => {
  it.each([
    ['Approved{by}', `(StructPattern ${named('Approved')} [(BindFieldPattern by _)])`],
    [
      'Rejected{reason as why}',
      `(StructPattern ${named('Rejected')} [(BindFieldPattern reason why)])`,
    ],
    [
      'Verdict{ok == false}',
      `(StructPattern ${named('Verdict')} [(CompareFieldPattern ok == false)])`,
    ],
    [
      'Order{amount > 1000}',
      `(StructPattern ${named('Order')} [(CompareFieldPattern amount > 1000)])`,
    ],
    [
      'Order{amount >= base * 2}',
      `(StructPattern ${named('Order')} [(CompareFieldPattern amount >= (Binary base * 2))])`,
    ],
    [
      'Some{value is Verdict{ok == false} as v}',
      `(StructPattern ${named('Some')} [(NestedFieldPattern value (AsPattern (StructPattern ${named('Verdict')} [(CompareFieldPattern ok == false)]) v))])`,
    ],
    [
      'Verdict{ok == false} as v',
      `(AsPattern (StructPattern ${named('Verdict')} [(CompareFieldPattern ok == false)]) v)`,
    ],
    ['struct{a, b}', '(StructPattern _ [(BindFieldPattern a _) (BindFieldPattern b _)])'],
    ['m.Pair{first,}', '(StructPattern (NamedType [m Pair] []) [(BindFieldPattern first _)])'],
    [
      'Pair{\n  first,\n  second\n}',
      `(StructPattern ${named('Pair')} [(BindFieldPattern first _) (BindFieldPattern second _)])`,
    ],
    ['Ok{}', `(StructPattern ${named('Ok')} [])`],
  ])('parses %j', (text, tree) => {
    expect(dumpClean('pattern', text)).toBe(tree);
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
