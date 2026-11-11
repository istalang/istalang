/**
 * `Mark`'s and `Sendability`'s orders where a variable stands for a slot (proposal 8, Rules 3
 * and 4): a function given or expected where one stands bounds it by the order, its bounds join by
 * it and settle to the least they allow, an upper bound alone choosing as any variable's does; a
 * callee's own mark settles at most to its caller's, a mark decided above that left to the call
 * rule; and a function type ending in a pack fits by the same orders.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const logged = `
fn logged<...A, R, M in Mark, S in Sendability>(f: Fn<A, R, M, S>) -> Fn<A, R, M, S>:
  fn(...args: A) -> R: f(...args)
fn area(width: Int, height: Int) -> Int: width * height
`;

describe("a slot variable, by its slot's order", () => {
  it('joins sendable and plain functions to plain, and takes sendable from sendable ones alone', () => {
    expect(
      reported(`
fn both<S in Sendability>(f: Fn<(Int,), Int, "simple", S>, g: Fn<(Int,), Int, "simple", S>) -> Fn<(Int,), Int, "simple", S>: f
fn inc(x: Int) -> Int: x + 1
fn main():
  let n = 1
  n += 1
  const plain: fn(Int) -> Int = both(inc, fn(x: Int) -> Int: x + n)
  const sendable: sendable fn(Int) -> Int = both(inc, inc)
  _ = (plain, sendable)
`),
    ).toEqual(reportedNothing);
  });

  it("binds nothing from a lambda whose body isn't checked yet", () => {
    expect(
      reported(`${logged}
fn main():
  let n = 1
  n += 1
  const plain: fn(Int) -> Int = logged(fn(x: Int): x + n)
  _ = plain
`),
    ).toEqual(reportedNothing);
  });

  it('fits a sendable function where a pack function of any sendability is expected', () => {
    expect(
      reported(`
fn call<...A, R>(f: fn(...A) -> R, ...args: A) -> R: f(...args)
fn main() -> Int:
  const g: sendable fn(Int, Int) -> Int = fn(a: Int, b: Int) -> Int: a + b
  call(g, 3, 4)
`),
    ).toEqual(reportedNothing);
  });

  it("gives a lambda passed to a mark-generic call its code's mark, which fixes the call's", () => {
    expect(
      reported(`${logged}
ista fn step(x: Int) -> Int: x
ista fn main() -> Array<Int>:
  const wrapped = logged(fn(x: Int) -> Int: step(x))
  [1].map(fn(x): step(x)).map(wrapped)
`),
    ).toEqual(reportedNothing);
  });
});

describe('a mark or sendability variable, bounded by its order', () => {
  it('settles to the least its bounds allow, a simple argument giving a simple result', () => {
    expect(
      reported(`
fn logged1<M in Mark, S in Sendability>(f: Fn<(Int,), Int, M, S>) -> Fn<(Int,), Int, M, S>: f
struct Holder<M in Mark, S in Sendability> { f: Fn<(), Int, M, S> }
fn inc(x: Int) -> Int: x + 1
live fn ping(x: Int) -> Int: x
ista fn main():
  const kept = logged1(inc)
  const checkKept: Fn<(Int,), Int, "simple", "sendable"> = kept
  const deferred = defer(fn(): ())
  const checkDeferred: Deferred<"simple"> = deferred
  const h = Holder{f: fn() -> Int: 1}
  const checkH: Holder<"simple", "sendable"> = h
  _ = (checkKept, checkDeferred, checkH, logged1(ping))
`),
    ).toEqual(reportedNothing);
  });

  it('joins lower bounds by the order, and takes an upper bound where no lower one is', () => {
    expect(
      reported(`
fn choose<M in Mark, S in Sendability>(
  first: Bool,
  a: Fn<(Int,), Int, M, S>,
  b: Fn<(Int,), Int, M, S>,
) -> Fn<(Int,), Int, M, S>:
  if first: a else: b
fn wrapConsumer<S in Sendability>(
  take: Fn<(Fn<(), Int, "simple", S>,), Int>,
) -> Fn<(Fn<(), Int, "simple", S>,), Int>:
  fn(f: Fn<(), Int, "simple", S>) -> Int: take(f)
fn inc(x: Int) -> Int: x + 1
live fn liveInc(x: Int) -> Int: x + 1
live fn main(takesPlain: Fn<(Fn<(), Int, "simple", "plain">,), Int>):
  let n = 1
  n += 1
  const c1 = choose(true, inc, fn(x: Int) -> Int: x + n)
  const checkC1: Fn<(Int,), Int, "simple", "plain"> = c1
  const c2 = choose(false, inc, liveInc)
  const checkC2: Fn<(Int,), Int, "live", "sendable"> = c2
  const consumer = wrapConsumer(takesPlain)
  _ = (checkC1, checkC2, consumer(fn() -> Int: n))
`),
    ).toEqual(reportedNothing);
  });

  it('refuses lower bounds of both kinds, which the order joins to nothing', () => {
    expect(
      reported(`${logged}
fn choose<M in Mark>(first: Bool, a: Fn<(), Int, M>, b: Fn<(), Int, M>) -> Fn<(), Int, M>:
  if first: a else: b
live fn l() -> Int: 1
ista fn i() -> Int: 2
fn main(): _ = choose(true, l, i)
`).codes,
    ).not.toEqual([]);
  });

  it("fits a mark-generic call's result where a function of a kind is expected", () => {
    expect(
      reported(`
fn logged2<R, M in Mark, S in Sendability>(f: Fn<(Int, Int), R, M, S>) -> Fn<(Int, Int), R, M, S>: f
fn area(width: Int, height: Int) -> Int: width * height
live fn takesLive(f: live fn(Int, Int) -> Int) -> Int: f(1, 2)
live fn main() -> Int: takesLive(logged2(area))
`),
    ).toEqual(reportedNothing);
    expect(
      reported(`
M fn loggedHead<M in Mark, S in Sendability>(f: Fn<(Int,), Int, M, S>) -> Fn<(Int,), Int, M, S>: f
fn inc(x: Int) -> Int: x + 1
ista fn main():
  const kept: live fn(Int) -> Int = loggedHead(inc)
  _ = kept
`),
    ).toEqual(reportedNothing);
  });

  it('refuses a call of one of the two kinds where a simple function is expected, as a misfit', () => {
    expect(
      reported(`
fn needsSimple(f: fn() -> Int): ()
K fn make<K in Persistence>() -> Fn<(), Int, K>: panic("none")
ista fn main(): needsSimple(make())
`).codes,
    ).toEqual([checkerDiagnostics.typeMismatch.code]);
    expect(
      reported(`
fn pick(f: fn() -> Int) -> Int: 1
fn pick(f: ista fn() -> Int) -> String: ""
K fn make<K in Persistence>() -> Fn<(), Int, K>: panic("none")
ista fn main() -> String: pick(make())
`),
    ).toEqual(reportedNothing);
  });

  it('settles a sendability variable bounded only above by plain to plain, what takes it (B62)', () => {
    expect(
      reported(`
fn wrapConsumer<S in Sendability>(
  take: Fn<(Fn<(), Int, "simple", S>,), Int>,
) -> Shared<Fn<(Fn<(), Int, "simple", S>,), Int>>:
  new Shared{value: take}
fn main(takesPlain: Fn<(Fn<(), Int, "simple", "plain">,), Int>):
  const c = wrapConsumer(takesPlain)
  const check: Shared<Fn<(Fn<(), Int, "simple", "plain">,), Int>> = c
  _ = check
`),
    ).toEqual(reportedNothing);
  });
});

describe("a callee's mark, bounded by its caller's", () => {
  it('solves an undecided mark to the least at or below the caller, a caller K to K', () => {
    expect(
      reported(`
import * as time from 'time'
M fn nothing<M in Mark>() -> Fn<(), Int, M>: fn() -> Int: 1
ista async fn later() -> Int:
  const f = nothing()
  const checkF: Fn<(), Int, "simple"> = f
  await time.delay(1s)
  f()
K async fn waits<K in Persistence>() -> Int:
  await time.delay(1s)
  1
`),
    ).toEqual(reportedNothing);
  });

  it('leaves a decided mark above the bound to the call rule, which names the call', () => {
    const { codes } = reported(`
K async fn retry<K in Persistence, T>(f: Fn<(), Future<T, K>, K>, times: Int) -> T: await f()
live async fn fetch() -> Int: 1
ista fn main(): _ = retry(fetch, 3)
`);
    expect(codes).toContain(checkerDiagnostics.kindsMeet.code);
  });
});
