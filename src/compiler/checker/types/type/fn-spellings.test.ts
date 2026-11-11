/**
 * One function type, `Fn<Args, Result, Kind, Send>` (§3.14, proposal 8, Rule 4): every other
 * spelling is its sugar, so each resolves to the type, key and text of its `Fn` spelling; `Args` is
 * a tuple, `(A,)` for one parameter, with `&T` items for parameters taken by reference; and a
 * higher-order function keeps its argument's mark and sendability through written `M` and `S`.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  reportedNothing,
  reportedOnce,
} from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import type { TypeAliasDeclaration } from '../../../syntax/declarations/index.ts';
import { reported } from '../../check.test-kit.ts';
import { checkProgram } from '../../check.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { typeKeys } from '../identity/type-keys.ts';
import { typeText } from './type-text.ts';

/** Types a parameter or a result may be written as. */
const written = fc.constantFrom('Int', 'String', 'Int?', 'Array<Int>', '(Int, String)');

/** A function type's parts, from which both of its spellings are written. */
const parts = fc
  .record({
    parameters: fc.array(fc.record({ type: written, reference: fc.boolean() }), { maxLength: 3 }),
    result: written,
    mark: fc.constantFrom('simple', 'live', 'ista'),
    send: fc.constantFrom('sendable', 'plain'),
    isAsync: fc.boolean(),
  })
  .map((each) => ({ ...each, isAsync: each.isAsync && each.mark !== 'simple' }));

type Parts = typeof parts extends fc.Arbitrary<infer T> ? T : never;

function slots({ parameters }: Parts): readonly string[] {
  return parameters.map(({ type, reference }) => `${reference ? '&' : ''}${type}`);
}

/** `parts` written with the head's words, `sendable live async fn(A) -> R`. */
function sugar(each: Parts): string {
  const words = [
    each.send === 'sendable' ? 'sendable' : '',
    each.mark === 'simple' ? '' : each.mark,
    each.isAsync ? 'async' : '',
  ].filter((word) => word !== '');
  return `${[...words, 'fn'].join(' ')}(${slots(each).join(', ')}) -> ${each.result}`;
}

/** `parts` written as `Fn<Args, Result, Kind, Send>`. */
function fnSpelling(each: Parts): string {
  const items = slots(each);
  const args = items.length === 1 ? `(${items[0]},)` : `(${items.join(', ')})`;
  const result = each.isAsync ? `Future<${each.result}, "${each.mark}">` : each.result;
  return `Fn<${args}, ${result}, "${each.mark}", "${each.send}">`;
}

/** The types top-level aliases of `spellings` stand for, and what checking them reported. */
function aliased(spellings: readonly string[]) {
  const source = spellings.map((type, index) => `type T${index} = ${type}`).join('\n');
  const program = stdProgramOf({ 'main.ista': `${source}\n` });
  const checker = checkProgram(program);
  const items = program.modules.get(idOf('main.ista'))?.tree.root.items ?? [];
  return {
    types: items.map((item) => checker.aliasedType(item as TypeAliasDeclaration)),
    diagnostics: checker.diagnosticsOf(idOf('main.ista')),
  };
}

describe('every spelling of a function type', () => {
  it("is its Fn spelling's type, key and text, over parameters, marks and sendabilities", () => {
    fc.assert(
      fc.property(parts, (each) => {
        const { types, diagnostics } = aliased([sugar(each), fnSpelling(each)]);
        const [fromSugar, fromFn] = types;
        expect(diagnostics).toEqual([]);
        expect(fromSugar && typeKeys.typeKey(fromSugar)).toBe(fromFn && typeKeys.typeKey(fromFn));
        expect(fromSugar && typeText(fromSugar)).toBe(fromFn && typeText(fromFn));
      }),
      { numRuns: 40 },
    );
  });

  it('writes a type whose slots are variables as Fn', () => {
    const program = stdProgramOf({
      'main.ista': 'fn keep<T, M in Mark, S in Sendability>(f: Fn<(T,), T, M, S>): ()\n',
    });
    const checker = checkProgram(program);
    const [keep] = program.modules.get(idOf('main.ista'))?.tree.root.items ?? [];
    const [f] = keep?.kind === 'FunctionDeclaration' ? checker.parametersOf(keep) : [];
    expect(f && typeText(f.type)).toBe('Fn<(T,), T, M, S>');
  });
});

describe("an Fn's parameters", () => {
  it('take one parameter as a one-element tuple, and a reference as an &T item', () => {
    expect(
      reported(`
fn bump(x: &Int): x = x + 1
fn twice(f: Fn<(&Int,), Unit>, x: &Int):
  f(&x)
  f(&x)
fn apply(f: Fn<(Int,), Int>, x: Int) -> Int: f(x)
fn main():
  let n = 1
  twice(bump, &n)
  _ = apply(fn(x): x * n, 2)
`),
    ).toEqual(reportedNothing);
  });

  it('are a tuple, or a pack', () => {
    expect(reported('fn f(g: Fn<Int, Int>): ()')).toEqual(
      reportedOnce(checkerDiagnostics.fnArgumentsNotTuple.code, 'Int'),
    );
  });

  it("take & only on an item of an Fn's tuple", () => {
    expect(reported('fn f(pair: (&Int, Int)): ()')).toEqual(
      reportedOnce(checkerDiagnostics.misplacedReferenceItem.code, '&Int'),
    );
  });
});

describe('a head naming its mark', () => {
  it('is generic over its mark, which may be its parameter or an associated type', () => {
    expect(
      reported(`
M fn each<T, M in Mark>(xs: Array<T>, f: Fn<(T,), Unit, M>):
  for x in xs:
    f(x)
K async fn twice<K in Persistence, T>(f: Fn<(), Future<T, K>, K>) -> T:
  _ = await f()
  await f()
trait Waits:
  type Mode in Persistence
  Self.Mode fn wait(self: Self)
trait Settles:
  type Mode in Persistence
  Self.Mode async fn settle(self: Self) -> Int
ista async fn one() -> Int: 1
ista async fn main():
  each([1, 2], fn(x): ())
  _ = await twice(one)
`),
    ).toEqual(reportedNothing);
  });

  it('names a mark parameter, one of the two kinds on an async head', () => {
    expect(reported('X fn f<X>(): ()')).toEqual(
      reportedOnce(checkerDiagnostics.unknownMark.code, 'X'),
    );
    expect(reported('M async fn f<M in Mark>() -> Int: 1')).toEqual(
      reportedOnce(checkerDiagnostics.asyncMarkNotKind.code, 'M'),
    );
    expect(
      reported(`
trait HasMode:
  type Mode
T.Mode fn f<T is HasMode>(x: T): ()
`),
    ).toEqual(reportedOnce(checkerDiagnostics.unknownMark.code, 'T.Mode'));
    expect(
      reported(`
struct NotAMark {}
fn main():
  NotAMark fn helper() -> Int: 1
  _ = helper()
`),
    ).toEqual(reportedOnce(checkerDiagnostics.unknownMark.code, 'NotAMark'));
  });

  it('names an associated type bounded to marks, to one of the two kinds on an async head', () => {
    expect(reported('trait Waits:\n  type Mode\n  Self.Mode fn wait(self: Self)')).toEqual(
      reportedOnce(checkerDiagnostics.unknownMark.code, 'Self.Mode'),
    );
    expect(
      reported('trait Waits:\n  type Mode in Mark\n  Self.Mode async fn wait(self: Self) -> Int'),
    ).toEqual(reportedOnce(checkerDiagnostics.asyncMarkNotKind.code, 'Self.Mode'));
  });
});

describe('a higher-order function written over M and S', () => {
  const logged = `
fn logged<...A, R, M in Mark, S in Sendability>(f: Fn<A, R, M, S>) -> Fn<A, R, M, S>:
  fn(...args: A) -> R: f(...args)
fn area(width: Int, height: Int) -> Int: width * height
`;

  it("keeps a sendable argument's sendability, and a plain one's", () => {
    expect(
      reported(`${logged}
fn main():
  let n = 1
  n += 1
  const sendable: sendable fn(Int, Int) -> Int = logged(area)
  const plain: fn(Int) -> Int = logged(fn(x: Int) -> Int: x + n)
  _ = (sendable, plain)
`),
    ).toEqual(reportedNothing);
    expect(
      reported(`${logged}
fn main():
  let n = 1
  n += 1
  const wrong: sendable fn(Int) -> Int = logged(fn(x: Int) -> Int: x + n)
  _ = wrong
`),
    ).toEqual(
      reportedOnce(checkerDiagnostics.typeMismatch.code, 'logged(fn(x: Int) -> Int: x + n)'),
    );
  });

  it('joins marks through their order, a simple argument fixing none', () => {
    expect(
      reported(`
fn choose<M in Mark, S in Sendability>(
  first: Bool,
  a: Fn<(Int,), Int, M, S>,
  b: Fn<(Int,), Int, M, S>,
) -> Fn<(Int,), Int, M, S>:
  if first: a else: b
M fn runBoth<...A, R, M in Mark>(a: Fn<A, R, M>, b: Fn<A, R, M>) -> Int: 0
fn inc(x: Int) -> Int: x + 1
live fn liveInc(x: Int) -> Int: x + 1
live fn main(plainSimple: Fn<(Int,), Int, "simple", "plain">):
  const c2: Fn<(Int,), Int, "live", "sendable"> = choose(false, inc, liveInc)
  _ = (c2, runBoth(plainSimple, liveInc), runBoth(liveInc, plainSimple))
`),
    ).toEqual(reportedNothing);
  });

  it('gives a lambda or local function the mark parameter expected or declared for it', () => {
    expect(
      reported(`
ista fn makeWrapper<M in Mark>(f: Fn<(), Int, M>) -> Fn<(), Int, M>:
  fn() -> Int: f()
fn wrapSecond<M1 in Mark, M2 in Mark>(
  f: Fn<(), Int, M1>,
  g: Fn<(), Int, M2>,
) -> Fn<(), Int, M2>:
  M2 fn helper() -> Int: g()
  fn() -> Int: helper()
`),
    ).toEqual(reportedNothing);
  });

  it('keeps invariant positions invariant in mark and sendability', () => {
    expect(
      reported(`
fn main():
  const cell: Shared<sendable fn() -> Int> = new Shared{value: fn() -> Int: 42}
  const alias: Shared<fn() -> Int> = cell
  _ = alias
`),
    ).toEqual(reportedOnce(checkerDiagnostics.typeMismatch.code, 'cell'));
    expect(
      reported(`
fn main(f: Fn<(&Fn<(), Int, "simple">,), Unit>):
  const g: Fn<(&Fn<(), Int, "live">,), Unit> = f
  _ = g
`),
    ).toEqual(reportedOnce(checkerDiagnostics.typeMismatch.code, 'f'));
  });

  it("keeps a live argument's mark, which ista code can't call", () => {
    const source = (code: string) => `
live fn shout(x: Int) -> Int: x
${code} fn main() -> Array<Int>: [1].map(shout)
`;
    expect(reported(source('live'))).toEqual(reportedNothing);
    expect(reported(source('ista')).codes).toEqual([checkerDiagnostics.kindsMeet.code]);
  });
});
