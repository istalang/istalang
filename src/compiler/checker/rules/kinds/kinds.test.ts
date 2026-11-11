/**
 * The kinds' rules as the checker judges them (proposal 8, Rules 2–4): calls of every form judged
 * where they are made, what a signature, a nested function's included, holds, and a mark
 * parameter's kind settled at its call. What a body handles is data-kinds.test.ts's.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { codesOf, reportedMessages, socket } from './kinds.test-kit.ts';

const codes = checkerDiagnostics;

describe('calls between kinds', () => {
  it('judges the calls a construct makes as written ones: an operator, `in`, a template, `for`', () => {
    const source = [
      'struct B { n: Int }',
      'ista fn compare(a: B, b: B) -> Int: 0',
      'ista fn includes(self: B, x: Int) -> Bool: true',
      'ista fn toString(self: B) -> String: ""',
      'ista fn iterate(self: B) -> fn() -> Step<Int>: fn(): Step.Done',
      'live fn main():',
      '  const b = B{n: 1}',
      '  _ = b < b',
      '  _ = 1 in b',
      '  _ = `${b}`',
      '  for x in b: _ = x',
    ];
    expect(codesOf(...source)).toEqual(Array.from({ length: 4 }, () => codes.kindsMeet.code));
  });

  it('holds a deferred call of the other kind, which only its taker calls', () => {
    expect(
      codesOf(
        'live async fn charge(a: Int) -> Int: a',
        'ista fn runJob(j: sendable live async fn() -> Int): ()',
        'ista fn main(): runJob charge(10)',
      ),
    ).toEqual([]);
    expect(
      codesOf(
        'ista async fn work(x: Int) -> Int: x',
        'fn queueUp(j: ista async fn() -> Int): _ = j',
        'fn helper(x: Int): queueUp work(x)',
      ),
    ).toEqual([]);
  });

  it('computes defaults in their function, of its kind', () => {
    const source = [
      "import * as time from 'time'",
      'ista fn defaultId() -> Int: 1',
      'ista fn a(id: Int = defaultId()) -> Int: id',
      'live fn liveId() -> Int: 1',
      'live fn b(id: Int = liveId()) -> Int: id',
      'ista async fn c(t: Future<Unit, "ista"> = time.delay(5s)): await t',
    ];
    expect(codesOf(...source)).toEqual([]);
  });

  it("infers a callee's mark from its argument before bounding it by its caller's", () => {
    const source = [
      'K async fn retry<K in Persistence, T>(f: Fn<(), Future<T, K>, K>) -> T: await f()',
      'live async fn fetchLive() -> Int: 1',
      'ista async fn caller() -> Int: await retry(fetchLive)',
    ];
    expect(codesOf(...source)).toContain(codes.kindsMeet.code);
  });

  it('says what simple code calling what is of a kind needs, naming the callee', () => {
    const { codes: found, messages } = reportedMessages(
      'ista async fn bg() -> Int: 1',
      'fn startBg(): drop bg()',
    );
    expect(found).toContain(codes.unmarkedCalls.code);
    expect(messages.join()).toContain("'bg'");
    // `defer` takes `M in Mark`, so simple code defers (proposal 8, Rule 10).
    expect(codesOf('fn c(): ()', 'fn w(): _ = defer c()')).toEqual([]);
  });

  it('judges a non-blocking `select` in a plain function by its kind', () => {
    const source = [
      'fn make<K in Persistence>() -> Future<Int, K>: panic("x")',
      'live fn poll() -> Bool:',
      '  select:',
      '    case make<"ista">(): true',
      '    else: false',
    ];
    expect(codesOf(...source)).toContain(codes.waitOfOtherKind.code);
  });
});

describe('what code holds and makes', () => {
  it('reads every kind a signature holds, a future value and a tuple included', () => {
    const source = [
      socket,
      'ista fn a(x: (Future<Int, "ista">, Socket)): ()',
      'live fn b(x: (Socket, Future<Int, "ista">)): ()',
      'ista fn c(x: Future<Socket, "ista">): ()',
    ];
    expect(codesOf(...source)).toEqual(Array.from({ length: 3 }, () => codes.holdsBothKinds.code));
  });

  it("judges a local function's and a lambda's signature as a declared one's", () => {
    const source = [
      socket,
      'ista fn main():',
      '  const a = live async fn() -> Future<Int, "ista">: 1',
      '  live async fn b() -> Future<Int, "ista">: 1',
      '  ista fn c(s: Socket): ()',
      '  fn d(s: Socket): ()',
      '  _ = (a, b, c, d)',
    ];
    expect(codesOf(...source)).toEqual([
      codes.kindsHeld.code,
      codes.kindsHeld.code,
      codes.kindsHeld.code,
      codes.unmarkedHolds.code,
    ]);
  });

  it('refuses making a value whose release runs code of the other kind', () => {
    const source = [
      'shared struct R { n: Int }',
      'ista async fn child() -> Int: 1',
      'ista fn dispose(self: R): _ = spawn child()',
      'live async fn main() -> Int:',
      '  const r = new R{n: 1}',
      '  r->n',
    ];
    expect(codesOf(...source)).toEqual([codes.kindsHeld.code]);
    expect(
      codesOf("import Revertible from 'inbox'", 'live fn bad(r: Revertible<Int>): ()'),
    ).toEqual([codes.kindsHeld.code]);
  });

  it('refuses an async lambda given no kind where its code has no one kind for its future', () => {
    const source = ['fn runBg():', '  const f = async fn() -> Int: 1', '  drop f()'];
    expect(codesOf(...source)).toEqual([codes.unkindedFuture.code]);
  });
});

describe('requirements and overloads over kinds', () => {
  it("lets a type's own kind meet an unmarked requirement: a revertible send is disposable", () => {
    const source = [
      "import Revertible from 'inbox'",
      'ista fn weak(r: Revertible<Int>) -> WeakRef<Revertible<Int>>: WeakRef(r)',
    ];
    expect(codesOf(...source)).toEqual([]);
  });

  it('finds two unmarked overloads taking unmarked function types swapped covariantly clashing', () => {
    const source = [
      'fn f(a: fn() -> Int, b: fn() -> Int?): ()',
      'fn f(a: fn() -> Int?, b: fn() -> Int): ()',
    ];
    expect(codesOf(...source)).toContain(checkerDiagnostics.overloadClash.code);
  });
});

describe('function values and kinds', () => {
  it('gives a function generic over its kind, passed as an argument, the kind expected of it', () => {
    const source = [
      'K async fn two<K in Persistence>() -> Int: 2',
      'fn takesLive(f: live async fn() -> Int): _ = f',
      "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
      '  takesLive(two)',
      '  0',
    ];
    expect(codesOf(...source)).toEqual([]);
  });

  it('gives an async lambda written whole the kind expected of it', () => {
    const source = [
      'fn takesLive(f: live async fn() -> Int): ()',
      'ista fn main(): takesLive(async fn() -> Int: 1)',
    ];
    expect(codesOf(...source)).toEqual([]);
  });

  it("chooses among overloads on the two kinds by a lambda's written kind", () => {
    const source = [
      'fn pick(f: live async fn(Int) -> Int) -> Int: 1',
      'fn pick(f: ista async fn(Int) -> Int) -> Int: 2',
      'fn main() -> Int: pick(live async fn(x): x)',
    ];
    expect(codesOf(...source)).toEqual([]);
  });
});

describe('kind parameters and requirements', () => {
  it('takes a kind parameter its signature only takes a value of as no kind of its own', () => {
    const source = [
      'fn describe<K in Persistence>(k: K) -> String: "ok"',
      'ista fn main() -> String: describe("live")',
    ];
    expect(codesOf(...source)).toEqual([]);
  });

  it("takes a requirement's mark as its head writes it, its trait's kind parameter included", () => {
    expect(
      codesOf('trait Producer<K in Persistence> { K fn produce(self: Self) -> Future<Int, K> }'),
    ).toEqual([]);
    expect(
      codesOf('trait Producer<K in Persistence> { fn produce(self: Self) -> Future<Int, K> }'),
    ).toEqual([codes.unmarkedHolds.code]);
  });
});
