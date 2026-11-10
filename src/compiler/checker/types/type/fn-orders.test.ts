/**
 * `DataKind`'s and `Sendability`'s orders where a variable stands for a slot (proposal 8, Rule 4):
 * the bottom of each, `"simple"` and `"sendable"`, fits any variable and fixes none, so a variable
 * given functions of several sendabilities joins to the greatest, an unconstrained `S` settles to
 * `"sendable"`, and a function type ending in a pack fits by the same orders.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { reported } from '../../check.test-kit.ts';

const logged = `
fn logged<...A, R, M in DataKind, S in Sendability>(f: Fn<A, R, M, S>) -> Fn<A, R, M, S>:
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
