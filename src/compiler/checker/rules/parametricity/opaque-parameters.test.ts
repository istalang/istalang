/**
 * Which type parameters a function's code uses only opaquely (§3.5): passed on, built into tuples,
 * functions and declared types laid out alike for every type, or given to a callee using them so;
 * never told apart by a union, a constraint, a test, or a callee or native that reads them.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { checkedAfterStd } from '../../../compile.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';

/** The names of the type parameters `name` uses only opaquely, `main` declaring it among `lines`. */
function opaqueOf(name: string, ...lines: string[]): readonly string[] {
  const program = stdProgramOf({ 'main.ista': lines.join('\n') });
  const checker = checkedAfterStd(program);
  const [declaration] = checker.topLevelFunctions(idOf('main.ista'), name);
  if (declaration === undefined) {
    throw new Error(`main.ista declares no '${name}'.`);
  }
  return [...checker.opaqueParametersOf(declaration)].map((parameter) => parameter.name.text);
}

const box = 'struct Box<T>:\n  value: T';

describe('a type parameter used only opaquely', () => {
  it.each([
    ['passed on', 'fn f<T>(x: T) -> T: x'],
    [
      'built into a tuple and a function type',
      'fn f<T>(x: T) -> (T, fn() -> T): (x, fn() -> T: x)',
    ],
    ['read from an array by a parametric native', 'fn f<T>(xs: Array<T>) -> T: xs[0]'],
    [
      'built into a declared type laid out alike for every type',
      `${box}\nfn f<T>(x: T) -> Box<T>: Box{value: x}`,
    ],
    ['given to itself', 'fn f<T>(x: T, n: Int) -> T:\n  if n == 0: x\n  else: f(x, n - 1)'],
    ['given to a callee using it opaquely', 'fn g<T>(x: T) -> T: x\nfn f<T>(x: T) -> T: g(x)'],
    ['awaited', 'ista async fn f<T>(x: Future<T, "ista">) -> T: await x'],
  ])('is opaque: %s', (_, declarations) => {
    expect(opaqueOf('f', declarations)).toEqual(['T']);
  });
});

describe('a type parameter whose type tells', () => {
  it.each([
    ['inside a union', 'fn f<T>(x: T) -> T?: x'],
    ['constrained', 'fn f<T is Stringable>(x: T) -> String: x.toString()'],
    ['tested', 'fn f<T>(x: Int | T) -> Bool: x is Int'],
    [
      'inside a declared type a union lays out',
      'struct Maybe<T>:\n  value: T?\nfn f<T>(x: Maybe<T>) -> Maybe<T>: x',
    ],
    ['given to a callee whose type tells', 'fn g<T>(x: T) -> T?: x\nfn f<T>(x: T): drop g(x)'],

    ['taken by an extern a host implements', 'extern fn f<T>(x: T) -> T'],
    ['named by no part of its signature', 'fn f<T>() -> Int: 1'],
    [
      'beside a transient, one per instance',
      'fn f<T>(x: T) -> T:\n  transient let n = 0\n  n += 1\n  x',
    ],
  ])('is concrete: %s', (_, declarations) => {
    expect(opaqueOf('f', declarations)).toEqual([]);
  });

  it('leaves another parameter opaque', () => {
    expect(opaqueOf('f', 'fn f<A, B>(a: A, b: B) -> (A, B?): (a, b)')).toEqual(['A']);
  });
});
