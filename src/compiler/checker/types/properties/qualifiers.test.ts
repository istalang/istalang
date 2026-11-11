/**
 * Mark and sendability parameters as their unions make them (proposal 8, Rules 3 and 4): known by
 * the union their `in` names, whatever spells it, and member parameters like any other, so a value
 * of one is one member of its union.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

describe('a mark parameter, as a member parameter', () => {
  it('gives a value of one member, compared, matched and given back as its union', () => {
    expect(
      reported(`
fn isLive<M in Mark>(m: M) -> Bool: m == "live"
fn index<M in Mark>(m: M) -> Int:
  match m:
    case "simple": 0
    case "live": 1
    case "ista": 2
fn back<M in Mark>(m: M) -> Mark: m
fn takeMark<M in Mark>(m: M) -> M: m
fn main() -> (Bool, Int, Mark, Mark):
  (isLive("ista"), index("simple"), back("live"), takeMark("live"))
`),
    ).toEqual(reportedNothing);
  });

  it('takes as its argument only a member of its union, a written subset or the two kinds', () => {
    const codes = (source: string) => reported(source).codes;
    expect(
      codes('K fn onlyLive<K in "live">() -> Int: 1\nista fn main() -> Int: onlyLive<"ista">()'),
    ).toEqual([checkerDiagnostics.notMemberArgument.code]);
    expect(
      codes(
        'M fn run<M in "simple" | "live">(f: Fn<(), Int, M>) -> Int: f()\nK fn pass<K in Persistence>(f: Fn<(), Int, K>) -> Int: run<K>(f)',
      ),
    ).toEqual([checkerDiagnostics.notMemberArgument.code]);
    const misfit = codes('fn f(x: Future<Int, Int>): ()');
    expect(misfit).toContain(checkerDiagnostics.notMemberArgument.code);
    expect(misfit).not.toContain(checkerDiagnostics.oneKindOfEither.code);
  });

  it('takes a written subset of the marks as a mark, a head naming it', () => {
    expect(
      reported(`
M fn run<M in "simple" | "live">(f: Fn<(), Int, M>) -> Int: f()
type Kinds = "live" | "ista"
K async fn wait<K in Kinds>(f: Fn<(), Future<Int, K>, K>) -> Int: await f()
live fn one() -> Int: 1
live async fn two() -> Int: 2
live async fn main() -> Int: run(one) + await wait(two)
`),
    ).toEqual(reportedNothing);
  });
});
