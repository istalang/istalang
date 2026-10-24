/**
 * Postfix forms (§3.9): calls with type arguments (G9), `&` and spread arguments (G11, G12),
 * indexing and slicing, member access, `?.`, `?` and `$`.
 */

import { describe, expect, it } from 'vitest';
import { parserDiagnostics } from '../diagnostics.ts';
import { dumpClean, named, parseAs, reported, reportedOnce } from '../parse.test-kit.ts';

describe('calls', () => {
  it.each([
    ['f()', '(Call f [] [])'],
    ['f(a, b)', '(Call f [] [a b])'],
    ['f(a, b,)', '(Call f [] [a b])'],
    ['f(\n  a,\n  b\n)', '(Call f [] [a b])'],
    ['f(&value)', '(Call f [] [(Reference value)])'],
    ['f(&s.items, x)', '(Call f [] [(Reference (MemberAccess s items)) x])'],
    ['log("info", "a", ...more)', '(Call log [] ["info" "a" (Spread more)])'],
    ['float(3)', '(Call float [] [3])'],
    ['f(a)(b)', '(Call (Call f [] [a]) [] [b])'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it("reports '&' on part of an argument, or outside a call (G11)", () => {
    const { misplacedReference } = parserDiagnostics;
    expect(reported('expression', 'f(&a + b)')).toEqual(
      reportedOnce(misplacedReference.code, '&a'),
    );
    expect(reported('expression', '&x')).toEqual(reportedOnce(misplacedReference.code, '&x'));
    expect(reported('expression', 'f((&x))')).toEqual(reportedOnce(misplacedReference.code, '&x'));
  });
});

describe('type arguments (G9)', () => {
  it.each([
    ['swap<int, string>(p)', `(Call swap [${named('int')} ${named('string')}] [p])`],
    ['Slot.create<Verdict>()', `(Call (MemberAccess Slot create) [${named('Verdict')}] [])`],
    [
      'Shared<Future<unit>?>(x)',
      `(Call Shared [(OptionalType (NamedType [Future] [${named('unit')}]))] [x])`,
    ],
    ['a < b > (c)', `(Call a [${named('b')}] [c])`],
    ['a + f<T>(x)', `(Binary a + (Call f [${named('T')}] [x]))`],
    ['xs.map<int>(f)', `(Call (MemberAccess xs map) [${named('int')}] [f])`],
  ])('reads %s as type arguments', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it.each([
    ['a < b', '(Binary a < b)'],
    ['a < b > c', '(Binary (Binary a < b) > c)'],
    ['(a < b) > (c)', '(Binary (Parenthesized (Binary a < b)) > (Parenthesized c))'],
    ['a < 1 > (c)', '(Binary (Binary a < 1) > (Parenthesized c))'],
    ['a < b + c > (d)', '(Binary (Binary a < (Binary b + c)) > (Parenthesized d))'],
    ['f() < b > (c)', '(Binary (Binary (Call f [] []) < b) > (Parenthesized c))'],
  ])('reads %s as comparisons, reporting nothing', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it('parses the call after type arguments for real, so its errors are reported', () => {
    expect(reported('expression', 'f<int>(a b)')).toEqual(
      reportedOnce(parserDiagnostics.expected.code, 'b'),
    );
  });
});

describe('indexing, members and postfix operators', () => {
  it.each([
    ['a[1]', '(Index a 1)'],
    ['m["a"]', '(Index m "a")'],
    ['a[1..3]', '(Index a (Range 1 3))'],
    ['xs[..5]', '(Index xs (Range _ 5))'],
    ['xs[3..]', '(Index xs (Range 3 _))'],
    ['xs[..]', '(Index xs (Range _ _))'],
    ['a.b', '(MemberAccess a b)'],
    ['a.type', '(MemberAccess a type)'],
    ['user?.name', '(MemberAccess user isOptional name)'],
    ['a?.m()', '(Call (MemberAccess a isOptional m) [] [])'],
    ['2.pow(10)', '(Call (MemberAccess 2 pow) [] [10])'],
    ['T.zero()', '(Call (MemberAccess T zero) [] [])'],
    ['chargeCard(id)?', '(Propagate (Call chargeCard [] [id]))'],
    ['u$', '(Unwrap u)'],
    ['u$.name', '(MemberAccess (Unwrap u) name)'],
    ['users[0]$.name', '(MemberAccess (Unwrap (Index users 0)) name)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it.each([
    ['a.', ''],
    ['a[1 2]', '2'],
    ['a[]', ']'],
  ])('reports %j once', (text, spanText) => {
    expect(reported('expression', text)).toEqual(
      reportedOnce(parserDiagnostics.expected.code, spanText),
    );
  });

  it('stops at a line break outside brackets, as a statement would', () => {
    const parsed = parseAs('expression', 'a\n.b');
    expect(parsed.rest).toBe(2);
    expect(parsed.diagnostics).toEqual([]);
  });
});
