/**
 * Behavioural and end-to-end verification of Phase V1: variance derivation and markers (`gives`,
 * `takes`), conversions composing part by part through variance, recursive types (`Json`, `Tree`,
 * `List`), runtime equality and map keys by declaration, persistence across commits, and JSON
 * round-trips (docs/spec.md §2, §3.1, §3.5, §3.6, §3.8, §3.14, §3.15, §3.18).
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { compiledText } from '../../src/compiler/compile.test-kit.ts';
import { parserDiagnostics } from '../../src/compiler/parser/diagnostics.ts';
import { startToEnd, testRuntime } from '../../src/runtime/runtime.test-kit.ts';
import { checkSnapshot } from '../../src/runtime/snapshot/check/index.ts';
import { snapshotFormat } from '../../src/runtime/snapshot/snapshot.ts';
import { codesOf, definitionOf, runMain } from './unions.test-kit.ts';

describe('contextual variance words `gives` and `takes` (§2, §3.5)', () => {
  it('allows `gives` and `takes` as ordinary identifiers outside type parameter prefixes', async () => {
    const decls = [
      'struct Holder { takes: Int }',
      'fn takes(gives: Holder) -> Int: gives.takes',
      'struct Box<gives T> { gives: T, takes: Int }',
    ];
    expect(
      await runMain(
        'Int',
        [
          'const g = Holder{takes: 10}',
          'const b: Box<Int?> = Box{gives: 20, takes: 30}',
          'takes(g) + (b.gives ?? 0) + b.takes',
        ].join('\n  '),
        decls,
      ),
    ).toBe(60);
  });

  it('reports two variance words on one type parameter (2310)', () => {
    expect(codesOf('extern struct Bad<gives takes T>')).toEqual([
      parserDiagnostics.twoVariances.code,
    ]);
    expect(codesOf('extern struct Bad<takes gives T>')).toEqual([
      parserDiagnostics.twoVariances.code,
    ]);
  });

  it('rejects variance markers on handles (5260), functions, traits and aliases (5261)', () => {
    expect(
      codesOf(
        'extern shared struct H1<gives T>',
        'extern sendable struct H2<takes T>',
        'extern live struct H3<gives T>',
        'shared struct H4<takes T> { v: T }',
        'fn f<gives T>(x: T) -> T: x',
        'trait Tr<takes T> { fn step(self: Self, x: T) }',
        'type Al<gives T> = Array<T>',
      ),
    ).toEqual([
      checkerDiagnostics.varianceOnHandle.code,
      checkerDiagnostics.varianceOnHandle.code,
      checkerDiagnostics.varianceOnHandle.code,
      checkerDiagnostics.varianceOnHandle.code,
      checkerDiagnostics.varianceNotHere.code,
      checkerDiagnostics.varianceNotHere.code,
      checkerDiagnostics.varianceNotHere.code,
    ]);
  });

  it('checks assertions on structs and enums against derived variance, including unused parameters (5262)', () => {
    expect(
      codesOf(
        'struct GoodCov<gives T> { v: T }',
        'struct GoodContra<takes T> { f: fn(T) -> Unit }',
        'struct GoodUnused<gives T> { n: Int }',
        'enum GoodEnum<gives T, takes U> { Val(v: T), Fn(f: fn(U) -> Unit) }',
      ),
    ).toEqual([]);

    expect(
      codesOf(
        'struct BadCov<takes T> { v: T }',
        'struct BadContra<gives T> { f: fn(T) -> Unit }',
        'struct BadInv1<gives T> { v: T, f: fn(T) -> Unit }',
        'struct BadInv2<takes T> { v: T, f: fn(T) -> Unit }',
        'struct BadUnused<takes T> { n: Int }',
        'enum BadEnum<takes T> { Some(v: T), Empty }',
        'type Status = "a" | "b"',
        'struct BadMember<gives S in Status> { s: S }',
      ),
    ).toEqual([
      checkerDiagnostics.varianceContradicted.code,
      checkerDiagnostics.varianceContradicted.code,
      checkerDiagnostics.varianceContradicted.code,
      checkerDiagnostics.varianceContradicted.code,
      checkerDiagnostics.varianceContradicted.code,
      checkerDiagnostics.varianceContradicted.code,
      checkerDiagnostics.varianceContradicted.code,
    ]);
  });
});

describe('variance derivation across positions and recursive declarations (§3.5, §3.18)', () => {
  it('keeps handles, `&`, map keys, an invariant trait’s `any` constraints, member parameters and computed positions invariant', () => {
    expect(
      codesOf(
        'import * as inbox from "inbox"',
        'trait HasData { type Data }',
        'trait Tag<T> { fn tag(self: Self, x: T) -> T }',
        'type Status = "a" | "b"',
        'type Match<T> = match T:',
        '  case Int: Int',
        '  case _: String',
        'struct ByRef<T> { f: fn(&T) -> Unit }',
        'struct BySlot<T> { s: Slot<T> }',
        'struct ByShared<T> { s: Shared<T> }',
        'struct ByInbox<T> { b: inbox.Inbox<T> }',
        'struct ByMapKey<K> { m: Map<K, Int> }',
        'struct ByAny<T> { a: any Tag<T> }',
        'struct ByAssoc<T is HasData> { d: T.Data }',
        'struct ByKeyof<S is struct { a: Int }> { k: keyof S }',
        'struct ByField<S is struct { a: Int }> { v: S["a"] }',
        'struct ByMapped<S is struct { [_]: Int }> { m: { [F in keyof S]: S[F] } }',
        'struct ByMatch<T> { m: Match<T> }',
        'struct ByMember<S in Status> { s: S }',
        'ista fn test(',
        '  r: ByRef<Int>, sl: BySlot<Int>, sh: ByShared<Int>, ib: ByInbox<Int>,',
        '  mk: ByMapKey<"a">, an: ByAny<Int>, md: ByMatch<Int>, mb: ByMember<"a">',
        '):',
        '  const r2: ByRef<Int?> = r',
        '  const sl2: BySlot<Int?> = sl',
        '  const sh2: ByShared<Int?> = sh',
        '  const ib2: ByInbox<Int?> = ib',
        '  const mk2: ByMapKey<String> = mk',
        '  const an2: ByAny<Int?> = an',
        '  const md2: ByMatch<Int?> = md',
        '  const mb2: ByMember<"b"> = mb',
      ),
    ).toEqual(Array.from({ length: 8 }, () => checkerDiagnostics.typeMismatch.code));
  });

  it('flips variance when a covariant struct with an unused parameter stands in a function parameter', async () => {
    const decls = [
      'struct Phantom<T> { n: Int }',
      'struct PhantomList<T> { next: PhantomList<T>? }',
      'struct Holder<takes T> { f: fn(Phantom<T>) -> Int }',
      'struct ListHolder<takes T> { f: fn(PhantomList<T>) -> Int }',
    ];
    expect(
      codesOf(
        ...decls,
        'fn bad1(h: Holder<Int>) -> Holder<Int?>: h',
        'fn bad2(h: ListHolder<Int>) -> ListHolder<Int?>: h',
      ),
    ).toEqual([checkerDiagnostics.typeMismatch.code, checkerDiagnostics.typeMismatch.code]);

    expect(
      await runMain(
        'Int',
        [
          'const h1: Holder<Int?> = Holder{f: fn(p): p.n + 1}',
          'const h2: Holder<Int> = h1',
          'const lh1: ListHolder<Int?> = ListHolder{f: fn(_): 10}',
          'const lh2: ListHolder<Int> = lh1',
          '(h2.f)(Phantom{n: 31}) + (lh2.f)(PhantomList{next: none})',
        ].join('\n  '),
        decls,
      ),
    ).toBe(42);
  });

  it('keeps self-contravariant `Loop<T>` invariant while recursive covariant `PhantomList<T>` converts', async () => {
    const decls = [
      'struct Loop<T> { f: fn(Loop<T>) -> Int }',
      'struct PhantomList<gives T> { next: PhantomList<T>? }',
    ];
    expect(
      codesOf(
        ...decls,
        'fn bad1(l: Loop<Int>) -> Loop<Int?>: l',
        'fn bad2(l: Loop<Int?>) -> Loop<Int>: l',
      ),
    ).toEqual([checkerDiagnostics.typeMismatch.code, checkerDiagnostics.typeMismatch.code]);

    expect(
      await runMain(
        'Bool',
        [
          'const p1: PhantomList<Int> = PhantomList{next: PhantomList{next: none}}',
          'const p2: PhantomList<Int?> = p1',
          'p2.next != none',
        ].join('\n  '),
        decls,
      ),
    ).toBe(true);
  });
});

describe('conversions composing inside types (§2, §3.1, §3.5, §3.14, §3.15)', () => {
  it('converts `Array<Int>` into `Array<Int?>`, persists across a commit, and round-trips through JSON', async () => {
    const decls = ['import * as json from "json"', 'import * as time from "time"'];
    const body = [
      'const ints: Array<Int> = [10, 20, 30]',
      'const opts: Array<Int?> = ints',
      'await time.delay(1ms)',
      'const text = json.stringify(opts)',
      'const decoded = match json.parse<Array<Int?>>(text):',
      '  case Ok(xs): (xs[0] ?? 0) + (xs[1] ?? 0) + (xs[2] ?? 0)',
      '  case Err(_): -1',
      '`${text}:${decoded}`',
    ].join('\n  ');
    const source = [
      ...decls,
      "import * as runtime from 'runtime'\nlive async fn main() -> String: await runtime.run(runtime.id()) _main()\nista async fn _main() -> String:",
      `  ${body}`,
    ].join('\n');
    const definition = definitionOf(source);
    const env = testRuntime();
    const ended = await startToEnd(env, compiledText(source));
    expect(env.store.commits.length).toBeGreaterThan(0);
    for (const saved of env.store.commits) {
      expect(() => checkSnapshot(definition, snapshotFormat.read(saved))).not.toThrow();
    }
    expect(ended).toEqual({ kind: 'finished', outcome: '"[10,20,30]:60"' });
  });

  it('converts contravariant structs, function parameters/results, and async fits inside containers', async () => {
    const decls = [
      'struct Sink<T> { take: fn(T) -> Int }',
      'fn handleOpt(x: Int?) -> Int: (x ?? 5) * 2',
    ];
    expect(
      await runMain(
        'Int',
        [
          'const sOpt: Sink<Int?> = Sink{take: handleOpt}',
          'const sInt: Sink<Int> = sOpt',
          'const f: ista async fn(Int) -> Int? = handleOpt',
          'const fs: Array<ista async fn(Int) -> Int?> = [handleOpt]',
          '(sInt.take)(3) + ((await f(4)) ?? 0) + ((await fs[0](6)) ?? 0)',
        ].join('\n  '),
        decls,
      ),
    ).toBe(26);
  });

  it('keeps one-element tuple conversions at the top only, including for recursive tuple aliases in unions', async () => {
    expect(
      codesOf(
        'fn a(xs: Array<(Int,)>) -> Array<Int>: xs',
        'fn b(xs: Array<Int>) -> Array<(Int,)>: xs',
        'fn c(t: ((Int,), String)) -> (Int, String): t',
        'fn d(s: { x: (Int,) }) -> { x: Int }: s',
        'fn e(f: fn((Int,)) -> Int) -> fn(Int) -> Int: f',
      ),
    ).toEqual(Array.from({ length: 5 }, () => checkerDiagnostics.typeMismatch.code));

    const decls = [
      'type SingleBox = (Array<SingleBox>,)',
      'type List = { head: Int, tail: List? }',
      'struct Node { tail: List?, head: Int }',
      'const topList: List? = Node{tail: none, head: 9}',
    ];
    expect(
      await runMain(
        'Int',
        [
          'const xs: Array<SingleBox> = []',
          'const optBox: SingleBox? = xs',
          'const count = match optBox:',
          '  case None: -1',
          '  case (items,): items.length()',
          'count + (topList?.head ?? 0)',
        ].join('\n  '),
        decls,
      ),
    ).toBe(9);
  });

  it('converts recursive `Tree<T>`, `List<T>`, and nested containers into `Json` and wider recursive types', async () => {
    const decls = [
      'import * as json from "json"',
      'type Tree<T> = T | Array<Tree<T>>',
      'type List<T> = { head: T, tail: List<T>? }',
      'struct Pixel { y: Int, x: Int }',
      'type Point = { x: Int?, y: Int? }',
      'fn sumTree(t: Tree<Int?>) -> Int:',
      '  match t:',
      '    case Array<Tree<Int?>> as kids:',
      '      let s = 0',
      '      for k in kids: s += sumTree(k)',
      '      s',
      '    case n: n ?? 0',
      'fn sumList(l: List<Int?>?) -> Int:',
      '  match l:',
      '    case None: 0',
      '    case node: (node.head ?? 0) + sumList(node.tail)',
    ];
    expect(
      await runMain(
        'String',
        [
          'const tree: Tree<Int> = [1, [2, 3]]',
          'const wideTree: Tree<Int?> = tree',
          'const asJson: json.Json = tree',
          'const list: List<Int> = struct{head: 4, tail: struct{head: 5, tail: none}}',
          'const wideList: List<Int?> = list',
          'const pixels: Tree<Pixel> = [Pixel{y: 2, x: 1}]',
          'const points: Tree<Point> = pixels',
          'const pt = match points:',
          '  case Array<Tree<Point>> as xs:',
          '    match xs[0]:',
          '      case Point as p: (p.x ?? 0) + (p.y ?? 0)',
          '      case _: 0',
          '  case _: 0',
          '`${sumTree(wideTree)}:${json.stringify(asJson)}:${sumList(wideList)}:${pt}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('6:[1,[2,3]]:9:3');
  });

  it('commutes generic union-part conversions with instantiation when the target union collapses', async () => {
    const decls = [
      'struct Box<T> { value: T }',
      'fn widenUnion<T>(x: T | Array<Int>) -> T | Array<Int?>: x',
      'fn widenBoxed<T>(b: Box<T | Array<Int>>) -> Box<T | Array<Int?>>: b',
    ];
    expect(
      await runMain(
        'Int',
        [
          'const xs: Array<Int?> = widenUnion<Array<Int?>>([10, 20])',
          'const bx: Box<Array<Int?>> = widenBoxed<Array<Int?>>(Box{value: [30]})',
          '(xs[0] ?? 0) + (xs[1] ?? 0) + (bx.value[0] ?? 0)',
        ].join('\n  '),
        decls,
      ),
    ).toBe(60);
  });
  it('converts top-level constants part by part, including unions of literals to their base', async () => {
    const decls = [
      'type Status = "draft" | "sent"',
      'const statuses: Array<Status> = ["draft", "sent"]',
      'const strings: Array<String> = statuses',
    ];
    expect(await runMain('String', '`${strings[0]}:${strings[1]}`', decls)).toBe('draft:sent');
  });
});

describe('runtime equality (`==`) and `Map` keys by declaration (§3.5, §3.8, §3.9)', () => {
  it('compares structs, variants, and collections widened without layout change equal to freshly built ones', async () => {
    const decls = ['struct Box<T> { value: T }', 'enum Choice<T> { Pick(value: T), Empty }'];
    expect(
      await runMain(
        'String',
        [
          'const bLit: Box<"s"> = Box{value: "s"}',
          'const bWide: Box<String> = bLit',
          'const bFresh: Box<String> = Box{value: "s"}',
          'let map: Map<Box<String>, Int> = [bWide: 1]',
          'map[bFresh] = 2',
          'const cLit: Choice<"s"> = Choice.Pick("s")',
          'const cWide: Choice<String> = cLit',
          'const cFresh: Choice<String> = Choice.Pick("s")',
          'let cMap: Map<Choice<String>, Int> = [cWide: 10]',
          'cMap[cFresh] = 20',
          'const arrLit: Array<Box<"s">> = [bLit]',
          'const arrWide: Array<Box<String>> = arrLit',
          '`${bWide == bFresh}:${map.size()}:${map[bWide]}:${cWide == cFresh}:${cMap.size()}:${cMap[cWide]}:${arrWide == [bFresh]}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('true:1:2:true:1:20:true');
  });
});
