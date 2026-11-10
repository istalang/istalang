/**
 * One "holds" relation (holds.ts): agreement, settling's lower bounds and choosing read the order
 * fitting defines, so a conversion inside a type holds as a member or a literal's base does, in
 * whichever order the types come; still, no union is inferred.
 */

import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../compile.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const declarations = [
  'struct Box<T> { value: T }',
  'struct Sink<T> { send: fn(T) -> Int }',
  'struct Late { a: Int, b: Int? }',
  'struct Early { a: Int?, b: Int }',
  'fn same<T>(a: T, b: T) -> T: a',
  'fn second<T>(a: T, b: T) -> T: b',
  'fn same3<T>(a: T, b: T, c: T) -> T: a',
  'fn holdsNone(xs: Array<Int?>) -> Bool: xs.includes(none)',
  'fn firstOrMinusOne(xs: Array<Int?>) -> Int:',
  '  match xs[0]:',
  '    case Int as n: n',
  '    case None: -1',
];

/** What checking `functions` after the declarations above reports. */
function reportedAfter(...functions: readonly string[]) {
  return reported([...declarations, ...functions, 'async fn main(): 0'].join('\n'));
}

/**
 * What `async fn main() -> Future<result>:` with `body` gives, after the declarations above and
 * `extra`.
 */
async function outcome(
  body: readonly string[],
  { extra = [], result = 'String' }: { extra?: readonly string[]; result?: string } = {},
): Promise<unknown> {
  const source = [
    ...declarations,
    ...extra,
    `async fn main() -> ${result}:`,
    ...body.map((line) => `  ${line}`),
  ].join('\n');
  const state = await startToEnd(testRuntime(), compiledText(source));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

const checksCleanly = { codes: [], spanTexts: [] };

describe('producers holding one another only by a conversion inside a type', () => {
  it('agree on the holder, in either order', () => {
    expect(
      reportedAfter(
        'fn branches(c: Bool, xs: Array<Int>, ys: Array<Int?>) -> Bool: (if c: xs else: ys).includes(none)',
        'fn swapped(c: Bool, xs: Array<Int>, ys: Array<Int?>) -> Bool: (if c: ys else: xs).includes(none)',
        'fn items(xs: Array<Int>, ys: Array<Int?>) -> Int: [xs, ys].length()',
        'fn itemsSwapped(xs: Array<Int>, ys: Array<Int?>) -> Int: [ys, xs].length()',
        'fn boxes(c: Bool, x: Box<"a">, y: Box<String>) -> Box<String>:\n  const z = if c: x else: y\n  z',
        'fn boxesSwapped(c: Bool, x: Box<"a">, y: Box<String>) -> Box<String>:\n  const z = if c: y else: x\n  z',
      ),
    ).toEqual(checksCleanly);
  });

  it('agree in either order where only widened types hold the others', () => {
    expect(
      reportedAfter(
        'fn widened(c: Bool, f: fn() -> Int, g: sendable fn() -> Int?) -> Int?:\n  const h = if c: f else: g\n  h()',
        'fn widenedSwapped(c: Bool, f: fn() -> Int, g: sendable fn() -> Int?) -> Int?:\n  const h = if c: g else: f\n  h()',
        'fn inside(c: Bool, k: "a", l: "b", y: Int?) -> Int?:\n  const p = if c: (k, 1) else: (l, y)\n  p.1',
        'fn insideSwapped(c: Bool, k: "a", l: "b", y: Int?) -> Int?:\n  const p = if c: (l, y) else: (k, 1)\n  p.1',
      ),
    ).toEqual(checksCleanly);
  });

  it('agree in either order where nothing expected decides each item', () => {
    expect(
      reportedAfter(
        'fn sent() -> any Sendable: [[1], [1, none]]',
        'fn sentSwapped() -> any Sendable: [[1, none], [1]]',
        'fn passes(s: Late) -> Int: [for k, v in ...s: [v]].length()',
        'fn passesSwapped(s: Early) -> Int: [for k, v in ...s: [v]].length()',
        'fn spread(xs: Array<Int>, ys: Array<Int?>) -> Int: [...["a": xs], "b": ys].size()',
        'fn spreadSwapped(xs: Array<Int>, ys: Array<Int?>) -> Int: [...["a": ys], "b": xs].size()',
      ),
    ).toEqual(checksCleanly);
  });

  it('convert the held one when it is the value', async () => {
    expect(
      await outcome([
        'const xs: Array<Int> = [1]',
        'const ys: Array<Int?> = [none]',
        'const zs = if xs.length() > 0: xs else: ys',
        'const ws = [xs, ys]',
        '`${holdsNone(zs)} ${ws.length()}`',
      ]),
    ).toBe('false 2');
  });

  it('settle a variable they bound to the holder', () => {
    expect(
      reportedAfter(
        'fn joined(xs: Array<Int>, ys: Array<Int?>) -> Bool: same(xs, ys).includes(none)',
        'fn joinedSwapped(xs: Array<Int>, ys: Array<Int?>) -> Bool: same(ys, xs).includes(none)',
      ),
    ).toEqual(checksCleanly);
  });

  it('infer no union where neither holds the other', () => {
    expect(
      reportedAfter('fn mixed(c: Bool) -> Int:\n  const v = if c: 1 else: "a"\n  0').codes,
    ).toEqual([checkerDiagnostics.branchTypes.code]);
    expect(
      reportedAfter(
        'fn mixedArrays(c: Bool, xs: Array<Int>, ys: Array<String>) -> Int:\n  const v = if c: xs else: ys\n  0',
      ).codes,
    ).toEqual([checkerDiagnostics.branchTypes.code]);
    expect(
      reportedAfter(
        'fn mixedSame(xs: Array<Int>, ys: Array<String>) -> Int:\n  _ = same(xs, ys)\n  0',
      ).codes,
    ).toEqual([checkerDiagnostics.cannotInfer.code]);
  });

  it('agree across match, returns, map literals, contravariant types and optional joins in both orders', () => {
    expect(
      reportedAfter(
        'fn matched1(n: Int, xs: Array<Int>, ys: Array<Int?>) -> Bool:\n  const m = match n:\n    case 1: xs\n    case _: ys\n  m.includes(none)',
        'fn matched2(n: Int, xs: Array<Int>, ys: Array<Int?>) -> Bool:\n  const m = match n:\n    case 1: ys\n    case _: xs\n  m.includes(none)',
        'fn returned1(c: Bool, xs: Array<Int>, ys: Array<Int?>):\n  if c:\n    return xs\n  ys',
        'fn returned2(c: Bool, xs: Array<Int>, ys: Array<Int?>):\n  if c:\n    return ys\n  xs',
        'fn maps1(xs: Array<Int>, ys: Array<Int?>) -> Bool: ["a": xs, "b": ys]["a"].includes(none)',
        'fn maps2(xs: Array<Int>, ys: Array<Int?>) -> Bool: ["a": ys, "b": xs]["b"].includes(none)',
        'fn sinks1(c: Bool, a: Sink<Int>, b: Sink<Int?>) -> Int: (if c: a else: b).send(1)',
        'fn sinks2(c: Bool, a: Sink<Int>, b: Sink<Int?>) -> Int: (if c: b else: a).send(1)',
        'fn sinkSame1(a: Sink<Int>, b: Sink<Int?>) -> Int: same(a, b).send(1)',
        'fn sinkSame2(a: Sink<Int>, b: Sink<Int?>) -> Int: same(b, a).send(1)',
        'fn withNone1(xs: Array<Int>, ys: Array<Int?>) -> Array<Array<Int?>?>: [xs, ys, none]',
        'fn withNone2(xs: Array<Int>, ys: Array<Int?>) -> Array<Array<Int?>?>: [none, ys, xs]',
        'fn sameWithNone1(xs: Array<Int>, ys: Array<Int?>) -> Array<Int?>?: same3(xs, ys, none)',
        'fn sameWithNone2(xs: Array<Int>, ys: Array<Int?>) -> Array<Int?>?: same3(none, ys, xs)',
      ),
    ).toEqual(checksCleanly);
  });

  it('rebuild held values into the holder representation across producer constructs and generic instantiations', async () => {
    const extra = [
      'fn ret1(c: Bool, xs: Array<Int>, ys: Array<Int?>):',
      '  if c:',
      '    return xs',
      '  ys',
      'fn ret2(c: Bool, xs: Array<Int>, ys: Array<Int?>):',
      '  if c:',
      '    return ys',
      '  xs',
      'fn genericPick<T>(c: Bool, xs: Array<T>, ys: Array<T?>) -> Array<T?>:',
      '  const branched = if c: xs else: ys',
      '  const reversed = if c: ys else: xs',
      '  if c: same(branched, ys) else: second(ys, reversed)',
      'struct S1 { a: Array<Int>, b: Array<Int?> }',
      'struct S2 { a: Array<Int?>, b: Array<Int> }',
    ];
    const body = [
      'const xs: Array<Int> = [10]',
      'const ys: Array<Int?> = [none]',
      'const if1 = if true: xs else: ys',
      'const if2 = if false: ys else: xs',
      'const arr1 = [xs, ys][0]',
      'const arr2 = [ys, xs][1]',
      'const sp1 = [...[xs], ...[ys]][0]',
      'const sp2 = [...[ys], ...[xs]][1]',
      'const mp1 = ["a": xs, "b": ys]["a"]',
      'const mp2 = ["a": ys, "b": xs]["b"]',
      'const msp1 = [...["a": xs], "b": ys]["a"]',
      'const msp2 = [...["b": ys], "a": xs]["a"]',
      'const r1 = ret1(true, xs, ys)',
      'const r2 = ret2(false, xs, ys)',
      'const sm1 = same(xs, ys)',
      'const sm2 = second(ys, xs)',
      'const fc1 = [for k, v in ...S1{a: xs, b: ys}: v][0]',
      'const fc2 = [for k, v in ...S2{a: ys, b: xs}: v][1]',
      'const gp1 = genericPick(true, xs, ys)',
      'const gp2 = genericPick(false, ys, ys)',
      '[firstOrMinusOne(if1), firstOrMinusOne(if2), firstOrMinusOne(arr1), firstOrMinusOne(arr2), firstOrMinusOne(sp1), firstOrMinusOne(sp2), firstOrMinusOne(mp1), firstOrMinusOne(mp2), firstOrMinusOne(msp1), firstOrMinusOne(msp2), firstOrMinusOne(r1), firstOrMinusOne(r2), firstOrMinusOne(sm1), firstOrMinusOne(sm2), firstOrMinusOne(fc1), firstOrMinusOne(fc2), firstOrMinusOne(gp1), firstOrMinusOne(gp2)]',
    ];
    expect(await outcome(body, { extra, result: 'Array<Int>' })).toEqual([
      ...Array.from({ length: 17 }, () => 10),
      -1,
    ]);
  });
});
