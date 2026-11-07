/**
 * Postfix forms (§3.9): calls with type arguments (§3.5), `&` and spread arguments (§3.7, §2),
 * indexing and slicing, member access, `?.`, `->` and `?`.
 */

import { describe, expect, it } from 'vitest';
import {
  reportedNothing,
  reportedOnce,
} from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { spanIn } from '../../../syntax/tree/positions.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { dumpClean, named, parseAs, reported } from '../../parse.test-kit.ts';

describe('calls', () => {
  it.each([
    ['f()', '(Call f [])'],
    ['f(a, b)', '(Call f [a b])'],
    ['f(a, b,)', '(Call f [a b])'],
    ['f(\n  a,\n  b\n)', '(Call f [a b])'],
    ['f(&value)', '(Call f [(Reference value)])'],
    ['f(&s.items, x)', '(Call f [(Reference (MemberAccess s items)) x])'],
    ['log("info", "a", ...more)', '(Call log ["info" "a" (Spread more)])'],
    ['Float(3)', '(Call Float [3])'],
    ['f(a)(b)', '(Call (Call f [a]) [b])'],
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
    ['f(&a?->b)', 'a?->b'],
    ['f(&xs?.[0])', 'xs?.[0]'],
    ['f(&t?.0)', 't?.0'],
    ['f(&a?.b->c)', 'a?.b->c'],
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
    [
      'swap<Int, String>(p)',
      `(Call (TypeApplication swap [${named('Int')} ${named('String')}]) [p])`,
    ],
    [
      'Slot.create<Verdict>()',
      `(Call (TypeApplication (MemberAccess Slot create) [${named('Verdict')}]) [])`,
    ],
    [
      'Shared<Future<Unit>?>(x)',
      `(Call (TypeApplication Shared [(OptionalType (NamedType [Future] [${named('Unit')}]))]) [x])`,
    ],
    ['a < b > (c)', `(Call (TypeApplication a [${named('b')}]) [c])`],
    ['a + f<T>(x)', `(Binary a + (Call (TypeApplication f [${named('T')}]) [x]))`],
    ['xs.map<Int>(f)', `(Call (TypeApplication (MemberAccess xs map) [${named('Int')}]) [f])`],
    ['a < 1 > (b)', '(Call (TypeApplication a [(LiteralType 1)]) [b])'],
    ['a < -1 > (b)', '(Call (TypeApplication a [(LiteralType (Unary - 1))]) [b])'],
    [
      'a < b | c > (d)',
      `(Call (TypeApplication a [(UnionType [${named('b')} ${named('c')}])]) [d])`,
    ],
    [
      'get<S, "region">{}',
      `(StructLiteral (NamedType [get] [${named('S')} (LiteralType "region")]) [])`,
    ],
  ])('reads %s as type arguments', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it.each([
    ['a < b', '(Binary a < b)'],
    ['a < b > c', '(ChainedComparison [a b c] [< >])'],
    ['(a < b) > (c)', '(Binary (Parenthesized (Binary a < b)) > (Parenthesized c))'],
    ['(a < 1) > (c)', '(Binary (Parenthesized (Binary a < 1)) > (Parenthesized c))'],
    ['a < 1.5 > (c)', '(ChainedComparison [a 1.5 (Parenthesized c)] [< >])'],
    ['a < b + c > (d)', '(ChainedComparison [a (Binary b + c) (Parenthesized d)] [< >])'],
    ['f() < b > (c)', '(ChainedComparison [(Call f []) b (Parenthesized c)] [< >])'],
  ])('reads %s as comparisons, reporting nothing', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it('parses the call after type arguments for real, so its errors are reported', () => {
    expect(reported('expression', 'f<Int>(a b)')).toEqual(
      reportedOnce(parserDiagnostics.expected.code, 'b'),
    );
  });
});

describe('indexing, members and postfix operators', () => {
  it.each([
    ['a[1]', '(Index a 1)'],
    ['m["a"]', '(Index m "a")'],
    ['a[1..3]', '(Index a (Range 1 3 _))'],
    ['xs[..5]', '(Index xs (Range _ 5 _))'],
    ['xs[3..]', '(Index xs (Range 3 _ _))'],
    ['xs[..]', '(Index xs (Range _ _ _))'],
    ['a.b', '(MemberAccess a b)'],
    ['a.type', '(MemberAccess a type)'],
    ['user?.name', '(MemberAccess user isOptional name)'],
    ['a?.m()', '(Call (MemberAccess a isOptional m) [])'],
    ['f?.()', '(Call f isOptional [])'],
    ['xs?.[0]', '(Index xs isOptional 0)'],
    ['t?.0', '(TupleElement t isOptional 0)'],
    ['t?.0.1', '(TupleElement (TupleElement t isOptional 0) 1)'],
    ['m?.["a"]', '(Index m isOptional "a")'],
    ['a?.b?.[i].c', '(MemberAccess (Index (MemberAccess a isOptional b) isOptional i) c)'],
    ['s.f?.(1, x)', '(Call (MemberAccess s f) isOptional [1 x])'],
    ['a?.f?.(x)', '(Call (MemberAccess a isOptional f) isOptional [x])'],
    ['2.pow(10)', '(Call (MemberAccess 2 pow) [10])'],
    ['T.zero()', '(Call (MemberAccess T zero) [])'],
    ['chargeCard(id)?', '(Propagate (Call chargeCard [id]))'],
    ['u->name', '(MemberAccess (Dereference -> u) name)'],
    ['u->name.first', '(MemberAccess (MemberAccess (Dereference -> u) name) first)'],
    ['users[0]->name', '(MemberAccess (Dereference -> (Index users 0)) name)'],
    ['t->0', '(TupleElement (Dereference -> t) 0)'],
    ['n?->value', '(MemberAccess (Dereference -> n isOptional) value)'],
    ['n? -> value', '(MemberAccess (Dereference -> (Propagate n)) value)'],
    [
      'head->next?->value',
      '(MemberAccess (Dereference -> (MemberAccess (Dereference -> head) next) isOptional) value)',
    ],
    ['n?->0', '(TupleElement (Dereference -> n isOptional) 0)'],
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
    ['f().1.name', '(MemberAccess (TupleElement (Call f []) 1) name)'],
    ['p.pair.0', '(TupleElement (MemberAccess p pair) 0)'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it('spans each element from the target to its own position', () => {
    const parsed = parseAs('expression', 't.10.2');
    const { node } = parsed;
    const inner = node.kind === 'TupleElement' ? node.target : undefined;
    expect([node, inner].map((each) => each && spanIn(parsed, each.span))).toEqual([
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

describe('`!`, named arguments and `spawn`', () => {
  it.each([
    ['x!', '(Unwrap x)'],
    ['a?.b!', '(Unwrap (MemberAccess a isOptional b))'],
    [
      'f(times: 5, backoff: 2s)',
      '(Call f [(NamedArgument times 5) (NamedArgument backoff 2000ms)])',
    ],
    ['f(1, target: &x)', '(Call f [1 (NamedArgument target (Reference x))])'],
    [
      'spawn w.run(job).result()',
      '(Call (MemberAccess (Spawn (Call (MemberAccess w run) [job])) result) [])',
    ],
    ['spawn f<Int>(x)', '(Spawn (Call (TypeApplication f [(NamedType [Int] [])]) [x]))'],
    ['await spawn f(x).result()', '(Await (Call (MemberAccess (Spawn (Call f [x])) result) []))'],
    [
      'spawn Job{a}.run()',
      '(Spawn (Call (MemberAccess (StructLiteral (NamedType [Job] []) [(FieldInitializer a _)]) run) []))',
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });
});
