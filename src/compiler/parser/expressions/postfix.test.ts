/**
 * Postfix forms (§3.9): calls with type arguments (§3.5), `&` and spread arguments (§3.7, §2),
 * indexing and slicing, member access, `?.`, `->` and `?`.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { dumpClean, named, parseAs, reported } from '../parse.test-kit.ts';

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

  it("reports '&' on part of an argument, or outside a call (§3.7)", () => {
    const { misplacedReference } = parserDiagnostics;
    expect(reported('expression', 'f(&a + b)')).toEqual(
      reportedOnce(misplacedReference.code, '&a'),
    );
    expect(reported('expression', '&x')).toEqual(reportedOnce(misplacedReference.code, '&x'));
    expect(reported('expression', 'f((&x))')).toEqual(reportedOnce(misplacedReference.code, '&x'));
  });

  it.each([
    ['f(&g())', 'g()'],
    ['f(&g().x)', 'g().x'],
    ['f(&a?.b)', 'a?.b'],
  ])("reports '&' passing what is no place, %s (§3.7)", (text, spanText) => {
    const { referenceNotPlace } = parserDiagnostics;
    expect(reported('expression', text)).toEqual(reportedOnce(referenceNotPlace.code, spanText));
  });

  it.each(['f(&x)', 'f(&x.y[0].1)', 'f(&x->y)', 'f(&*x)', 'f(&(x))'])(
    "passes the place %s by '&'",
    (text) => {
      expect(reported('expression', text)).toEqual(reportedNothing);
    },
  );
});

describe('type arguments (§3.5)', () => {
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
    ['u->name', '(MemberAccess (Dereference u) name)'],
    ['u->name.first', '(MemberAccess (MemberAccess (Dereference u) name) first)'],
    ['users[0]->name', '(MemberAccess (Dereference (Index users 0)) name)'],
    ['t->0', '(TupleElement (Dereference t) 0)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});

describe('tuple elements (§3.15)', () => {
  it.each([
    ['t.0', '(TupleElement t 0)'],
    ['t.12', '(TupleElement t 12)'],
    ['t.0.1', '(TupleElement (TupleElement t 0) 1)'],
    ['t.1.0.2', '(TupleElement (TupleElement (TupleElement t 1) 0) 2)'],
    ['f().1.name', '(MemberAccess (TupleElement (Call f [] []) 1) name)'],
    ['p.pair.0', '(TupleElement (MemberAccess p pair) 0)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it('spans each element from the target to its own position', () => {
    const { node } = parseAs('expression', 't.10.2');
    const inner = node.kind === 'TupleElement' ? node.target : undefined;
    expect([node.span, inner?.span]).toEqual([
      { start: 0, end: 6 },
      { start: 0, end: 4 },
    ]);
  });

  it.each(['t.01', 't.0x1', 't.0b1', 't.1_0', 't.1e3', 't.1.5e2', 't.0.01'])(
    'reports %s once, naming the position',
    (text) => {
      expect(reported('expression', text)).toEqual(
        reportedOnce(parserDiagnostics.invalidTupleElement.code, text.slice(2)),
      );
    },
  );

  it('takes no element after ?.', () => {
    expect(reported('expression', 't?.0')).toEqual(
      reportedOnce(parserDiagnostics.expected.code, '0'),
    );
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
