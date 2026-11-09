/**
 * Lambdas (§3.14) and parameter lists: every lambda form, defaults, rest and reference parameters,
 * and a body that ends at the next `,` or `)`.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { dumpClean, int, reported } from '../../parse.test-kit.ts';

const param = (name: string, type = '_', value = '_') => `(Parameter ${name} _ ${type} ${value})`;

describe('lambda forms', () => {
  it.each([
    ['fn(x): x * 2', `(Lambda _ [${param('x')}] _ (Binary x * 2))`],
    ['fn x: x > 0', `(Lambda _ [${param('x')}] _ (Binary x > 0))`],
    ['fn(): 5', '(Lambda _ [] _ 5)'],
    [
      'async fn(msg): await handle(msg)',
      `(Lambda async _ [${param('msg')}] _ (Await (Call handle [msg])))`,
    ],
    [
      'fn(x: Int, y: Int) -> Int: x * y',
      `(Lambda _ [${param('x', int)} ${param('y', int)}] ${int} (Binary x * y))`,
    ],
    ['fn f(n: Int) -> Int: n', `(Lambda f [${param('n', int)}] ${int} n)`],
    [
      'fn(a, b = 1, ...rest: Array<Int>,): a',
      `(Lambda _ [${param('a')} ${param('b', '_', '1')} (Parameter isRest rest _ (NamedType [Array] [${int}]) _)] _ a)`,
    ],
    [
      'fn(self: &Stack<T>): self',
      `(Lambda _ [${param('self', '(ReferenceType (NamedType [Stack] [(NamedType [T] [])]))')}] _ self)`,
    ],
    [
      'fn(x): fn(y): x + y',
      `(Lambda _ [${param('x')}] _ (Lambda _ [${param('y')}] _ (Binary x + y)))`,
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('expression', text)).toBe(tree);
  });

  it('ends a body at the next comma or closing parenthesis', () => {
    expect(dumpClean('expression', 'f(fn(x): x, y)')).toBe(
      `(Call f [(Lambda _ [${param('x')}] _ x) y])`,
    );
    expect(dumpClean('expression', 'xs.filter(fn a: a > 0)')).toBe(
      `(Call (MemberAccess xs filter) [(Lambda _ [${param('a')}] _ (Binary a > 0))])`,
    );
  });

  it.each([
    ['fn: 5', ':'],
    ['fn(x) x', 'x'],
    ['async (x): x', '('],
    ['fn(+): x', '+'],
  ])('reports the malformed lambda %j once', (text, spanText) => {
    expect(reported('expression', text)).toEqual(
      reportedOnce(parserDiagnostics.expected.code, spanText),
    );
  });
});
