/**
 * Deferred calls, `g f(args)` (§3.14): a name on a taker's line starts the call it is given, at
 * prefix `await`'s level, nesting from the right; anything else keeps its meaning.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { dumpClean, dumpOf, lines, parseAs, reported } from '../../parse.test-kit.ts';

describe('deferred calls', () => {
  it.each([
    ['retry fetchUser(id)', '(DeferredCall retry (Call fetchUser [id]))'],
    [
      'retry load(id).process()',
      '(DeferredCall retry (Call (MemberAccess (Call load [id]) process) []))',
    ],
    ['a b c(x)', '(DeferredCall a (DeferredCall b (Call c [x])))'],
    [
      'retry(times: 5) fetchUser(id)',
      '(DeferredCall (Call retry [(NamedArgument times 5)]) (Call fetchUser [id]))',
    ],
    ['pool.submit encode(file)', '(DeferredCall (MemberAccess pool submit) (Call encode [file]))'],
    ['m.retry(3) f(x)', '(DeferredCall (Call (MemberAccess m retry) [3]) (Call f [x]))'],
    ['await retry f(x)', '(Await (DeferredCall retry (Call f [x])))'],
    ['-a b(c)', '(Unary - (DeferredCall a (Call b [c])))'],
    ['not a b(c)', '(Unary not (DeferredCall a (Call b [c])))'],
    ['a b(c) + 1', '(Binary (DeferredCall a (Call b [c])) + 1)'],
    ['(g f()).x', '(MemberAccess (Parenthesized (DeferredCall g (Call f []))) x)'],
    ['g(\n  a,\n) f(x)', '(DeferredCall (Call g [a]) (Call f [x]))'],
    ['[a b(c)]', '(ArrayLiteral [(DeferredCall a (Call b [c]))])'],
    ['[a,\n b c(d)]', '(ArrayLiteral [a (DeferredCall b (Call c [d]))])'],
    ['a b', '(DeferredCall a b)'],
    [
      'spawn f<Int>(x)',
      '(DeferredCall spawn (Call (TypeApplication f [(NamedType [Int] [])]) [x]))',
    ],
    [
      'spawn Job{a}.run()',
      '(DeferredCall spawn (Call (MemberAccess (StructLiteral (NamedType [Job] []) [(FieldInitializer a _)]) run) []))',
    ],
    [
      'await (spawn f(x)).result()',
      '(Await (Call (MemberAccess (Parenthesized (DeferredCall spawn (Call f [x]))) result) []))',
    ],
  ])('parses %j', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it.each([
    ['spawn purchase(req)', '(ExpressionStatement (DeferredCall spawn (Call purchase [req])))'],
    ['_ = defer log(x)', '(Assignment [_] = (DeferredCall defer (Call log [x])))'],
  ])('starts a statement: %j', (text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });

  it.each([
    ['0..n by step(2)', '(Range 0 n (Call step [2]))'],
    ['[a\n b(c)]', '(ArrayLiteral [a (Call b [c])])'],
  ])('leaves %j to what it meant before', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it.each(['a.b?.c f(x)', 'g<Int>(a) f(x)', 'f()() g(x)', '1 f(x)'])(
    'starts no deferred call after %j, which no taker is shaped as',
    (text) => {
      expect(parseAs('expression', text).rest).toBeGreaterThan(0);
    },
  );

  it('takes only a name on the taker’s line, in brackets too', () => {
    const parsed = parseAs('expression', 'xs[a\n b(c)]');
    expect(reported('expression', 'xs[a\n b(c)]')).toEqual(
      reportedOnce(parserDiagnostics.expected.code, 'b'),
    );
    expect(dumpOf(parsed).startsWith('(Index xs a)')).toBe(true);
  });

  it('keeps an annotation’s value apart from the statement it annotates', () => {
    expect(dumpClean('module', lines('async fn f():', '  @Waypoint log(x)'))).toContain(
      '(Call log [x])',
    );
    expect(dumpClean('module', lines('async fn f():', '  @Waypoint log(x)'))).not.toContain(
      'DeferredCall',
    );
  });
});
