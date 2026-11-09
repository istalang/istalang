/**
 * End-to-end and behavioural verification of the optional join (docs/spec.md §2, §4;
 * docs/work/variance-inference/design.md §5): where several producers take one type and none is
 * expected, values that may be `none` agree on the optional of what the others agree on, in any
 * order, each wrapped into it (`if`, `match`, `select`, function and lambda returns, array and map
 * literals, indented literals, array spreads, and field comprehensions), while no other union is
 * ever inferred.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, hoverCodeAt, runMain, spelledTypeOf } from './unions.test-kit.ts';

describe('optional join across branching constructs and returns (§2, §4)', () => {
  it('joins `T` and `none` into `T?` in `if`, `match`, and `select` in any order, wrapping values at runtime', async () => {
    expect(
      await runMain(
        'String',
        [
          'const s1 = Slot.create<Int>()',
          'const s2 = Slot.create<Unit>()',
          'await s1.put(9)',
          'await s2.put(())',
          'const if1 = if true: 4 else: none',
          'const if2 = if false: 4 else: none',
          'const if3 = if true: none else: 4',
          'const if4 = if false: none else: 4',
          'const m1 = match 1:',
          '  case 0: none',
          '  case n: n + 10',
          'const m2 = match 0:',
          '  case 0: none',
          '  case n: n + 10',
          'const sel1 = await select:',
          '  case s1.take() as v: v',
          '  case s2.read(): none',
          'const sel2 = await select:',
          '  case s2.take(): none',
          '  case s1.take() as v: v',
          '`${if1 ?? -1}:${if2 ?? -1}:${if3 ?? -1}:${if4 ?? -1}:${m1 ?? -1}:${m2 ?? -1}:${sel1 ?? -1}:${sel2 ?? -1}`',
        ].join('\n  '),
      ),
    ).toBe('4:-1:-1:4:11:-1:9:-1');

    expect(hoverCodeAt('fn f(c: Bool):', '  const x‸ = if c: 1 else: none', '  _ = x')).toEqual([
      '(variable) x: Int?',
    ]);
    expect(hoverCodeAt('fn f(c: Bool):', '  const x‸ = if c: none else: 1', '  _ = x')).toEqual([
      '(variable) x: Int?',
    ]);
  });

  it('agrees across nested branching expressions in either order', async () => {
    expect(
      await runMain(
        'String',
        [
          'const k1: "a" = "a"',
          'const k2: "b" = "b"',
          'const n1 = if true: none else: (if true: 1 else: 2)',
          'const n3 = if true: (if false: 2 else: none) else: 1',
          'const s1 = if false: (if true: k1 else: none) else: k2',
          '`${n1 ?? -1}:${n3 ?? -1}:${s1 ?? "-"}`',
        ].join('\n  '),
      ),
    ).toBe('-1:-1:b');
  });

  it('infers `T?` for functions, async functions, local functions, and lambdas returning `T` and `none` in any order', async () => {
    const decls = [
      'fn syncNoneFirst(miss: Bool):',
      '  if miss:',
      '    return none',
      '  10',
      'fn syncValFirst(miss: Bool):',
      '  if not miss:',
      '    return 20',
      '  none',
      'async fn asyncNoneFirst(miss: Bool):',
      '  if miss:',
      '    return none',
      '  30',
      'fn unitOrNone(miss: Bool):',
      '  if not miss:',
      '    return',
      '  none',
      'fn pairReturn(a: Bool, b: Bool, k1: "a", k2: "b"):',
      '  if a:',
      '    return none',
      '  if b:',
      '    return (k1, 1)',
      '  (k2, 2)',
    ];
    expect(
      await runMain(
        'String',
        [
          'fn localJoin(c: Bool):',
          '  if c:',
          '    return 40',
          '  none',
          'const lam = fn(c: Bool): {',
          '  if c:',
          '    return none',
          '  50',
          '}',
          'const u1 = unitOrNone(false) is Unit',
          'const u2 = unitOrNone(true) is None',
          'const p = pairReturn(false, false, "a", "b") ?? ("-", 0)',
          '`${syncNoneFirst(false) ?? -1}:${syncNoneFirst(true) ?? -1}:${syncValFirst(false) ?? -1}:${syncValFirst(true) ?? -1}:${(await asyncNoneFirst(false)) ?? -1}:${localJoin(true) ?? -1}:${lam(false) ?? -1}:${u1}:${u2}:${p.0}${p.1}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('10:-1:20:-1:30:40:50:true:true:b2');
  });
});

describe('optional join in collections, spreads, and field comprehensions (§2, §4)', () => {
  it('joins items, keys, and values with `none` in array, map, indented, and top-level `const` literals', async () => {
    const decls = [
      'const topArr1 = [1, none]',
      'const topArr2 = [none, 2]',
      'const topMap = ["a": 3, "b": none]',
    ];
    expect(
      await runMain(
        'String',
        [
          'const a1 = [1, none]',
          'const a2 = [none, 1]',
          'const mVal1 = ["x": 10, "y": none]',
          'const mVal2 = ["x": none, "y": 10]',
          'const mKey1 = ["x": 1, none: 2]',
          'const mKey2 = [none: 1, "x": 2]',
          'const indArr =',
          '  - none',
          '  - 5',
          'const indMap =',
          '  "first": none',
          '  second: 6',
          '`${topArr1[0] ?? -1}:${topArr2[1] ?? -1}:${topMap["a"] ?? -1}:${a1[1] ?? -1}:${a2[0] ?? -1}:${mVal1["y"] ?? -1}:${mVal2["x"] ?? -1}:${mKey1[none]}:${mKey2["x"]}:${indArr[1] ?? -1}:${indMap["second"] ?? -1}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('1:2:3:-1:-1:-1:-1:2:2:5:6');
  });

  it('wraps spread items once the array literal agrees on `T?`, in any order, for variables, literals, and iterables', async () => {
    expect(
      await runMain(
        'String',
        [
          'const xs = [1, 2]',
          'const ns = [none]',
          'const s1 = [...xs, none]',
          'const s2 = [none, ...xs]',
          'const s3 = [...xs, ...ns]',
          'const s4 = [...ns, ...xs]',
          'const s5 = [...1..3, none]',
          'const s6 = [none, ...1..3]',
          'const s7 = [...[4, 5], none]',
          'const s8 = [none, ...[4, 5]]',
          'const s10 = [...[2, none], 1]',
          'const ind =',
          '  - ...xs',
          '  - none',
          '`${s1[0] ?? -1},${s1[2] ?? -1}|${s2[0] ?? -1},${s2[1] ?? -1}|${s3[2] ?? -1}|${s4[0] ?? -1}|${s5[0] ?? -1},${s5[2] ?? -1}|${s6[0] ?? -1},${s6[1] ?? -1}|${s7[0] ?? -1}|${s8[1] ?? -1}|${s10[1] ?? -1}|${ind[0] ?? -1},${ind[2] ?? -1}`',
        ].join('\n  '),
      ),
    ).toBe('1,-1|-1,1|-1|-1|1,-1|-1,1|4|4|-1|1,-1');
  });

  it('joins literal types, literal unions, written optionals, and composite literals with `none` in any order', async () => {
    const decls = [
      'type Status = "draft" | "sent"',
      'type MaybeString = String?',
      'fn keepStatus(a: Bool, b: Bool, s: Status, d: "draft"):',
      '  if a: d elif b: none else: s',
      'fn keepAlias(a: Bool, b: Bool, k: "a", m: MaybeString):',
      '  if a: k elif b: m else: none',
    ];
    expect(
      await runMain(
        'String',
        [
          'const k1: "a" = "a"',
          'const k2: "b" = "b"',
          'const l1 = [k1, k2, none]',
          'const l2 = [k1, none, k2]',
          'const l3 = [none, k1, k2]',
          'const p1 = [(k1, 1), (k2, 2), none]',
          'const p2 = [(k1, 1), none, (k2, 2)]',
          'const p3 = [none, (k1, 1), (k2, 2)]',
          'const st = String(keepStatus(true, false, "sent", "draft") ?? "sent")',
          'const al = keepAlias(true, false, "a", none) ?? "-"',
          '`${l1[0] ?? "-"}:${l2[2] ?? "-"}:${l3[1] ?? "-"}:${(p1[1] ?? ("-", 0)).0}:${(p2[2] ?? ("-", 0)).0}:${(p3[1] ?? ("-", 0)).0}:${st}:${al}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('a:b:a:b:b:a:draft:a');

    expect(
      hoverCodeAt(
        ...decls,
        'fn check(s: Status, d: "draft", m: MaybeString):',
        '  const x‸ = keepStatus(true, false, s, d)',
        '  _ = (x, m)',
      ),
    ).toEqual([`(variable) x: ${spelledTypeOf('Status?', decls)}`]);
    expect(
      hoverCodeAt(
        ...decls,
        'fn check(s: Status, d: "draft", m: MaybeString):',
        '  const y‸ = keepAlias(true, false, "a", m)',
        '  _ = (y, s, d)',
      ),
    ).toEqual(['(variable) y: MaybeString = String?']);
  });

  it('agrees on `T?` and `String?` across field-loop comprehensions over concrete and generic structs', async () => {
    const decls = [
      'struct OneField { a: Int }',
      'struct TwoFields { a: Int, b: Int }',
      'struct NoneFirst { a: None, b: Int }',
      'fn keysOrNone<S is struct>(s: S, c: Bool):',
      '  [for k, v in ...s: if c: k else: none]',
    ];
    expect(
      await runMain(
        'String',
        [
          'const k1 = [for k, v in ...OneField{a: 1}: if v > 0: k else: none]',
          'const kg = keysOrNone(TwoFields{a: 1, b: 2}, true)',
          'const v1 = [for k, v in ...NoneFirst{a: none, b: 7}: v]',
          '`${k1[0] ?? "-"}:${kg[0] ?? "-"}:${kg[1] ?? "-"}:${v1[0] ?? -1}:${v1[1] ?? -1}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('a:a:b:-1:7');

    expect(
      hoverCodeAt(
        ...decls,
        'fn check(s: OneField, c: Bool):',
        '  const xs‸ = [for k, v in ...s: if c: k else: none]',
        '  _ = xs',
      ),
    ).toEqual(['(variable) xs: Array<String?>']);
  });
});

describe('optional-joined expressions passed as call arguments (§2, §3.5)', () => {
  it('passes optional-joined branches and collection literals to generic functions in any order', async () => {
    const decls = [
      "import * as json from 'json'",
      'fn id<T>(x: T) -> T: x',
      'fn len<T>(xs: Array<T>) -> Int: xs.length()',
    ];
    expect(
      await runMain(
        'String',
        [
          'const c = true',
          'const opt: Int? = 9',
          'const a = id(if c: 1 else: none)',
          'const b = id(if c: none else: 2)',
          'const d = id(if c: none else: opt)',
          'const arr1 = id([3, none])',
          'const arr2 = id([none, 4])',
          'const arr3 = id([none, opt])',
          'const mp1 = id(["k": 5, "n": none])',
          'const mp2 = id(["n": none, "k": 6])',
          'const tup = id(([7, none], "ok"))',
          'const str = id(struct{items: [8, none]})',
          'const l = len([1, none]) + len([none, 1])',
          'const j = json.stringify([1, none]) + ":" + json.stringify(if c: 1 else: none)',
          '`${a ?? -1}:${b ?? -1}:${d ?? -1}:${arr1[0] ?? -1}:${arr2[1] ?? -1}:${arr3[1] ?? -1}:${mp1["k"] ?? -1}:${mp2["k"] ?? -1}:${tup.0[0] ?? -1}:${str.items[0] ?? -1}:${l}:${j}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('1:-1:-1:3:4:9:5:6:7:8:4:[1,null]:1');
  });
});

describe('refusal of non-optional union inference and mismatched producers (§2, §4)', () => {
  it('never infers a union of non-`None` types and reports only the disagreeing producer against `T?`', () => {
    expect(
      codesOf(
        'fn bad(a: Bool, b: Bool, m: Map<String, Int>):',
        '  const u1 = if a: 1 else: "a"',
        '  const u2 = [1, "a"]',
        '  const u3 = if a: none elif b: 1 else: "a"',
        '  const u4 = if a: 1 elif b: none else: "a"',
        '  const u5 = if a: 1 elif b: "a" else: none',
        '  const u6 = [none, 1, "a"]',
        '  const u7 = [1, none, "a"]',
        '  const u8 = [1, "a", none]',
        '  _ = (u1, u2, u3, u4, u5, u6, u7, u8, m)',
      ),
    ).toEqual([
      checkerDiagnostics.branchTypes.code,
      checkerDiagnostics.itemTypes.code,
      checkerDiagnostics.branchTypes.code,
      checkerDiagnostics.branchTypes.code,
      checkerDiagnostics.branchTypes.code,
      checkerDiagnostics.itemTypes.code,
      checkerDiagnostics.itemTypes.code,
      checkerDiagnostics.itemTypes.code,
    ]);
  });

  it("widens a map spread's pairs through the literal, on either side of a `none` (§3.5)", async () => {
    expect(
      await runMain(
        'String',
        [
          'const m: Map<String, Int> = ["a": 1]',
          'const pairs: Array<(String, Int)> = [("p", 2)]',
          'const after = [...m, "b": none]',
          'const before = ["b": none, ...m]',
          'const listed = [...pairs, "z": none]',
          'const j: json.Json = ["k": 3, ...m]',
          '`${after["a"] ?? -1}:${after["b"] ?? -1}:${before["a"] ?? -1}:${before.size()}:${listed["p"] ?? -1}:${json.stringify(j)}`',
        ].join('\n  '),
        ["import * as json from 'json'"],
      ),
    ).toBe('1:-1:1:2:2:{"a":1,"k":3}');
  });

  it('keeps `spelledTypeOf` untouched', () => {
    expect(spelledTypeOf('Int?')).toBe('Int?');
  });
});
