/**
 * The scope protocol (scope-protocol.ts): a field loop's passes each check the same text again, so
 * what one checks settles before it exits, and each pass reads its own field's types, whatever
 * scope the loop stands in.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../../stdlib/prelude/prelude.test-kit.ts';
import { reported } from '../../check.test-kit.ts';

const declarations = [
  'struct S { a: Int, b: String }',
  'fn id<T>(x: T) -> T: x',
  'fn show(x: Int) -> String: "int"',
  'fn show(x: String) -> String: "str"',
].join('\n');

describe('parentheses', () => {
  it('leave what they hold postponed in the scope, as it stands alone', () => {
    const uses = [
      'fn apply<A, B>(x: A, f: fn(A) -> B) -> B: f(x)',
      'fn take<T>(xs: Array<T>) -> Int: 0',
      'fn lambda() -> Int: apply(1, (fn x: x))',
      'fn value() -> Result<Int, String>: apply(1, (Result.Ok))',
      'fn empty() -> Int: take(id(([])))',
    ];
    expect(reported([declarations, ...uses, 'async fn main(): 0'].join('\n'))).toEqual(
      reportedNothing,
    );
  });
});

describe("a field loop's passes", () => {
  it('each settle a generic call they make on their own field', () => {
    const uses = [
      'fn literal(s: S) -> String: struct{for k, v in ...s: [k]: id(v)}.b',
      'fn copy<T is struct { a: Int, b: String }>(s: T) -> { [F in keyof T]: T[F] }:',
      '  struct{for k, v in ...s: [k]: id(v)}',
      'fn items(s: S) -> Array<Int | String>: [for k, v in ...s: id(v)]',
      'fn loop(s: S):',
      '  for k, v in ...s:',
      '    drop id(v)',
    ];
    expect(reported([declarations, ...uses, 'async fn main(): 0'].join('\n'))).toEqual(
      reportedNothing,
    );
  });

  it('each choose the overload their own field takes', async () => {
    const body =
      'const s = S{a: 1, b: "x"}\nconst y = struct{for k, v in ...s: [k]: show(v)}\n`${y.a} ${y.b}`';
    expect(await mainGives('String', body, declarations)).toBe('int str');
  });
});
