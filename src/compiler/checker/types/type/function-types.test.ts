/**
 * One function type for both spellings of an async one (§3.14): `ista async fn(A) -> R` and
 * `fn(A) -> Future<R, "ista">` resolve to one type, one key and one text, whatever `A` and `R` are.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  reportedNothing,
  reportedOnce,
} from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { reported } from '../../check.test-kit.ts';
import { checkProgram } from '../../check.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { typeKeys } from '../identity/type-keys.ts';
import { typeText } from './type-text.ts';

/** Written types, a function type parenthesized wherever another type holds it. */
const written: fc.Arbitrary<string> = fc.letrec<{ type: string }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom('Int', 'String', 'Unit', 'Int?', 'Bool'),
    tie('type').map((type) => `Array<${type}>`),
    tie('type').map((type) => `Future<${type}, "ista">`),
    fc.tuple(tie('type'), tie('type')).map(([first, second]) => `(${first}, ${second})`),
    fc.tuple(tie('type'), tie('type')).map(([taken, given]) => `(fn(${taken}) -> ${given})`),
    fc
      .tuple(tie('type'), tie('type'))
      .map(([taken, given]) => `(sendable ista async fn(${taken}) -> ${given})`),
  ),
})).type;

/** The types of a function's parameters written `types`, and what checking it reported. */
function resolved(types: readonly string[]) {
  const parameters = types.map((type, index) => `p${index}: ${type}`).join(', ');
  const program = stdProgramOf({ 'main.ista': `fn f(${parameters}):\n  ()\n` });
  const checker = checkProgram(program);
  const [declaration] = program.modules.get(idOf('main.ista'))?.tree.root.items ?? [];
  return {
    types: checker.parametersOf(declaration as FunctionDeclaration).map(({ type }) => type),
    diagnostics: checker.diagnosticsOf(idOf('main.ista')),
  };
}

describe('the two spellings of an async function type', () => {
  it('are one type, with one key and one text, in both kinds', () => {
    fc.assert(
      fc.property(fc.constantFrom('live', 'ista'), written, written, (kind, taken, given) => {
        const { types, diagnostics } = resolved([
          `${kind} async fn(${taken}) -> ${given}`,
          `${kind} fn(${taken}) -> Future<${given}, "${kind}">`,
        ]);
        const [async, plain] = types;
        expect(diagnostics).toEqual([]);
        expect(async && typeKeys.typeKey(async)).toBe(plain && typeKeys.typeKey(plain));
        expect(async && typeText(async)).toBe(plain && typeText(plain));
      }),
      { numRuns: 30 },
    );
  });

  it('checks a plain lambda body and its returns against the future or its value where async fn(A) -> R is expected (§3.5, §3.14)', () => {
    expect(
      reported(`
ista async fn later(x: Int) -> Int: x + 1
ista async fn fetchUser(id: String) -> String: id
ista async fn retryGeneric<R>(call: ista async fn(String) -> R) -> R: await call("u1")
ista async fn retryConcrete(call: ista async fn(String) -> String) -> String: await call("u1")

ista async fn main():
  const forwarded: ista async fn(Int) -> Int = fn(x): later(x)
  const retryInferred = await retryGeneric(fn(id): fetchUser(id))
  const retryExplicit = await retryGeneric<String>(fn(id): fetchUser(id))
  const retryConcreteResult = await retryConcrete(fn(id): fetchUser(id))
  const unionReturns: ista async fn(Int) -> Int | String = fn(x): {
    if x > 0:
      return "positive"
    1
  }
  const literalReturns: ista async fn(Int) -> "a" | "b" = fn(x): {
    if x > 0:
      return "a"
    "b"
  }
  const singleLiteralReturn: ista async fn(Int) -> "a" = fn(x): {
    return "a"
  }
  const bareVariantReturn: ista async fn(Int) -> Result<Int, String> = fn(x): {
    if x == 0:
      return Ok(0)
    Err("no")
  }
  const recursiveNamed: ista async fn(Int) -> Int = fn fact(n): if n <= 1: 1 else: n * fact(n - 1)
  _ = (
    forwarded,
    retryInferred,
    retryExplicit,
    retryConcreteResult,
    unionReturns,
    literalReturns,
    singleLiteralReturn,
    bareVariantReturn,
    recursiveNamed,
  )
`),
    ).toEqual(reportedNothing);
  });

  it('refuses passing an element or shared-struct accessor by & to any call returning a future (§3.7, §3.14)', () => {
    expect(
      reported(`
ista async fn later(x: &Int) -> Int:
  x += 1
  x

ista fn starting(x: &Int) -> Future<Int, "ista">: later(&x)

ista async fn main():
  let xs = [10]
  _ = await starting(&xs[0])
`),
    ).toEqual(reportedOnce(checkerDiagnostics.accessorToAsync.code, 'xs[0]'));

    expect(
      reported(`
trait Mutator:
  ista fn mutate(self: Self, x: &Int) -> Future<Int, "ista">

struct M {}
ista async fn mutate(self: M, x: &Int) -> Int:
  x += 1
  x

ista async fn main():
  let xs = [10]
  const m: any Mutator = M
  _ = await m.mutate(&xs[0])
`),
    ).toEqual(reportedOnce(checkerDiagnostics.accessorToAsync.code, 'xs[0]'));
  });

  it('refuses a collection setIndex returning Future<Unit> even when declared with plain fn (§3.9, §3.14)', () => {
    expect(
      reported(`
struct Bag { values: Map<String, Int> }

fn index(self: Bag, key: String) -> Int:
  self.values[key]

ista async fn laterSet() -> Unit:
  ()

ista fn setIndex(self: &Bag, key: String, value: Int) -> Future<Unit, "ista">:
  _ = (self, key, value)
  laterSet()

ista async fn main():
  let bag = Bag{values: [:]}
  bag["a"] = 1
`),
    ).toEqual(reportedOnce(checkerDiagnostics.asyncCollectionFunction.code, 'bag["a"]'));
  });

  it('fits async fn(...A) -> Never where async fn(...A) -> R is expected on packs and constants (§2, §3.5, §3.14)', () => {
    expect(
      reported(`
const diverged: sendable ista async fn(Int) -> Int = async fn(x: Int) -> Never: panic("no")
fn wrap<...A>(f: ista async fn(...A) -> Never) -> ista async fn(...A) -> Int: f
fn main():
  _ = diverged
`),
    ).toEqual(reportedNothing);
  });

  it('prefers an overload taking a plain function as-is over one making it async for a plain lambda with written parameter types (§3.7, §3.14)', () => {
    expect(
      reported(`
fn run(f: fn(Int) -> Int, y: Int?) -> String: "sync"
fn run(f: ista async fn(Int) -> Int, y: Int) -> String: "async"
fn main():
  _ = run(fn(x: Int): x + 1, 1)
`),
    ).toEqual(reportedNothing);
  });

  it.each([
    [
      'live async fn() -> Int into ista async fn() -> Int',
      'fn takesIsta(f: ista async fn() -> Int): ()\nfn main(g: live async fn() -> Int):\n  takesIsta(g)',
    ],
    [
      'live async fn() -> Int into ista async fn() -> Int?',
      'fn takesIstaOpt(f: ista async fn() -> Int?): ()\nfn main(g: live async fn() -> Int):\n  takesIstaOpt(g)',
    ],
    [
      'Future<Never, "live"> into Future<Int, "ista">',
      'ista fn takesIstaFuture(f: Future<Int, "ista">): ()\nlive fn main(g: Future<Never, "live">):\n  takesIstaFuture(g)',
    ],
  ])('refuses fitting %s across kinds', (_, source) => {
    expect(reported(source)).toEqual(reportedOnce(checkerDiagnostics.typeMismatch.code, 'g'));
  });

  it('infers K across a widened future result and disposes futures of both kinds', () => {
    expect(
      reported(`
fn inferKind<K in Persistence>(f: fn() -> Future<Int?, K>): ()
live fn watchLive(f: Future<Int, "live">) -> WeakRef<Future<Int, "live">>: WeakRef(f)
ista fn main(g: ista async fn() -> Int):
  inferKind(g)
`),
    ).toEqual(reportedNothing);
  });
});
