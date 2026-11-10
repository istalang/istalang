/**
 * Behavioural and end-to-end verification of Phase V2: trait variance derivation (`any Trait<T>`),
 * meeting `any Trait<B>` through a fitting `Trait<A>`, dispatch and required-field conversions,
 * downcasts, prelude generic traits (`Iterable`, `Container`, `Indexable`), and exact `self` on
 * witnesses and `is` constraints (docs/spec.md §2, §3.5, §3.10).
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, runMain, spelledTypeOf } from './unions.test-kit.ts';

const baseTraits = [
  'trait Source<T>:',
  '  fn next(self: Self) -> T',
  'trait Sink<T>:',
  '  fn put(self: Self, x: T) -> Int',
  'trait Cell<T>:',
  '  fn get(self: Self) -> T',
  '  fn set(self: Self, x: T) -> Int',
  'trait Sized<T>:',
  '  size: T',
];

describe('design.md §9 acceptance anchors and exact `self` on witnesses (§3.10)', () => {
  it('widens `any Source<Int>` to `any Source<Int?>` and converts `next()` to `Int?`', async () => {
    const decls = [
      ...baseTraits,
      'struct IntSource { value: Int }',
      'fn next(self: IntSource) -> Int: self.value',
    ];
    expect(
      await runMain(
        '(Int, Bool)',
        [
          'const narrow: any Source<Int> = IntSource{value: 42}',
          'const wide: any Source<Int?> = narrow',
          'const item: Int? = wide.next()',
          'const matched = match item:',
          '  case Int as n: n',
          '  case none: -1',
          '(matched, item != none)',
        ].join('\n  '),
        decls,
      ),
    ).toEqual([42, true]);
  });

  it('converts `IntSource{}` directly into `any Source<Int?>` and admits `case IntSource` without warning', async () => {
    const decls = [
      ...baseTraits,
      'struct IntSource { value: Int }',
      'struct StrSource { value: String }',
      'fn next(self: IntSource) -> Int: self.value',
      'fn next(self: StrSource) -> String: self.value',
    ];
    expect(
      codesOf(
        ...decls,
        'fn check() -> Int:',
        '  const s: any Source<Int?> = IntSource{value: 7}',
        '  match s:',
        '    case IntSource as src: src.value',
        '    case _: 0',
      ),
    ).toEqual([]);

    expect(
      await runMain(
        '(Int, Bool)',
        [
          'const s: any Source<Int?> = IntSource{value: 7}',
          'const matched = match s:',
          '  case IntSource as src: src.value + 1',
          '  case _: 0',
          '(matched, s is IntSource)',
        ].join('\n  '),
        decls,
      ),
    ).toEqual([8, true]);

    // A type whose instantiation does not fit `Source<Int?>` is still ruled out (5422).
    expect(
      codesOf(
        ...decls,
        'fn ruledOut(s: any Source<Int?>) -> Int:',
        '  match s:',
        '    case StrSource: 1',
        '    case _: 0',
      ),
    ).toEqual([checkerDiagnostics.heldNoValue.code]);
  });

  it('rejects widening `any Sink<Int>` to `any Sink<Int?>` (5001) and allows narrowing `any Sink<Int?>` to `any Sink<Int>`', async () => {
    const decls = [
      ...baseTraits,
      'struct OptSink { offset: Int }',
      'fn put(self: OptSink, x: Int?) -> Int: (x ?? 0) + self.offset',
    ];
    expect(codesOf(...decls, 'fn bad(s: any Sink<Int>) -> any Sink<Int?>: s')).toEqual([
      checkerDiagnostics.typeMismatch.code,
    ]);
    expect(
      codesOf(
        ...decls,
        'struct IntSink { n: Int }',
        'fn put(self: IntSink, x: Int) -> Int: x + self.n',
        'fn badDirect() -> any Sink<Int?>: IntSink{n: 1}',
      ),
    ).toEqual([checkerDiagnostics.notConforming.code]);

    expect(
      await runMain(
        '(Int, Int)',
        [
          'const wide: any Sink<Int?> = OptSink{offset: 10}',
          'const narrow: any Sink<Int> = wide',
          'const direct: any Sink<Int> = OptSink{offset: 20}',
          '(narrow.put(5), direct.put(7))',
        ].join('\n  '),
        decls,
      ),
    ).toEqual([15, 27]);
  });

  it('keeps `self` exact on witnesses and `is` constraints, including when a trait uses `C = Self`', () => {
    expect(
      codesOf(
        ...baseTraits,
        'trait Shown { fn shown(self: Self) -> String }',
        'trait ShownSelf<C = Self> { fn shownSelf(self: C) -> String }',
        'struct IntSource { n: Int }',
        'fn next(self: IntSource) -> Int: self.n',
        'fn shown(self: Array<Int?>) -> String: "opts"',
        'fn shownSelf(self: Array<Int?>) -> String: "opts"',
        'fn takeExact<S is Source<Int?>>(s: S) -> Int?: s.next()',
        'fn takeShown<S is Shown>(s: S) -> String: s.shown()',
        'fn test(xs: Array<Int>):',
        '  _ = takeExact(IntSource{n: 1})',
        '  _ = takeShown(xs)',
        '  const a: any Shown = xs',
        '  const b: any ShownSelf = xs',
      ),
    ).toEqual([
      checkerDiagnostics.notConforming.code,
      checkerDiagnostics.notConforming.code,
      checkerDiagnostics.notConforming.code,
      checkerDiagnostics.notConforming.code,
    ]);
  });
});

describe('trait variance derivation and composition (§3.5, §3.10)', () => {
  it('derives variance from callback parameters, futures however a head gives them, `&`, and unused parameters', () => {
    const decls = [
      'trait GivesViaCallback<T> { fn subscribe(self: Self, cb: fn(T) -> Unit) }',
      'trait TakesViaCallback<T> { fn pull(self: Self, cb: fn() -> T) -> Int }',
      'trait AsyncGives<T> { ista async fn fetch(self: Self) -> T }',
      'trait SyncFutureHandle<T> { ista fn rawFuture(self: Self) -> Future<T, "ista"> }',
      'trait RefParam<T> { fn mutate(self: Self, target: &T) }',
      'trait PhantomTrait<T> { fn ping(self: Self) -> Int }',
      'struct WrapGives<gives T> { item: any GivesViaCallback<T> }',
      'struct WrapTakes<takes T> { item: any TakesViaCallback<T> }',
      'struct WrapAsync<gives T> { item: any AsyncGives<T> }',
      'struct WrapPhantom<gives T> { item: any PhantomTrait<T> }',
    ];
    expect(
      codesOf(
        ...decls,
        'fn ok1(x: any GivesViaCallback<Int>) -> any GivesViaCallback<Int?>: x',
        'fn ok2(x: any TakesViaCallback<Int?>) -> any TakesViaCallback<Int>: x',
        'fn ok3(x: any AsyncGives<Int>) -> any AsyncGives<Int?>: x',
        'fn ok4(x: any PhantomTrait<Int>) -> any PhantomTrait<Int?>: x',
        // A plain function giving a future is an async one (§3.14), awaited where it converts.
        'fn ok5(x: any SyncFutureHandle<Int>) -> any SyncFutureHandle<Int?>: x',
      ),
    ).toEqual([]);

    expect(
      codesOf(
        ...decls,
        'fn bad1(x: any GivesViaCallback<Int?>) -> any GivesViaCallback<Int>: x',
        'fn bad2(x: any TakesViaCallback<Int>) -> any TakesViaCallback<Int?>: x',
        'fn bad3(x: any RefParam<Int>) -> any RefParam<Int?>: x',
      ),
    ).toEqual([
      checkerDiagnostics.typeMismatch.code,
      checkerDiagnostics.typeMismatch.code,
      checkerDiagnostics.typeMismatch.code,
    ]);
  });

  it('converts callback arguments, multi-trait `any` objects, and unions through `any` at runtime', async () => {
    const decls = [
      ...baseTraits,
      'trait Subscribable<T> { fn onItem(self: Self, cb: fn(T) -> Int) -> Int }',
      'struct Emitter { v: Int }',
      'struct OptEmitter { v: Int? }',
      'fn onItem(self: Emitter, cb: fn(Int) -> Int) -> Int: cb(self.v)',
      'fn next(self: Emitter) -> Int: self.v',
      'fn next(self: OptEmitter) -> Int?: self.v',
      'fn put(self: OptEmitter, x: Int?) -> Int: (x ?? 0) + (self.v ?? 0)',
    ];
    expect(
      await runMain(
        '(Int, Int?, Int?, Int)',
        [
          'const sub: any Subscribable<Int?> = Emitter{v: 9}',
          'const u: Emitter | OptEmitter = Emitter{v: 12}',
          'const fromUnion: any Source<Int?> = u',
          'const both: any Source<Int?> & Sink<Int> = OptEmitter{v: 5}',
          '(',
          '  sub.onItem(fn(x: Int?): (x ?? 0) * 3),',
          '  fromUnion.next(),',
          '  both.next(),',
          '  both.put(8),',
          ')',
        ].join('\n  '),
        decls,
      ),
    ).toEqual([27, 12, 5, 13]);
  });

  it('absorbs a union member into an `any` member only when it meets the written constraint exactly (§2, §3.10)', () => {
    const decls = [
      ...baseTraits,
      'struct IntSource { n: Int }',
      'fn next(self: IntSource) -> Int: self.n',
    ];
    expect(spelledTypeOf('IntSource | any Source<Int>', decls)).toBe('any Source<Int>');
    expect(spelledTypeOf('IntSource | any Source<Int?>', decls)).toBe(
      'IntSource | any Source<Int?>',
    );
  });
});

describe('prelude generic traits (`Iterable`, `Container`, `Indexable`) through `any` (§3.8, §3.10)', () => {
  it('converts `Array<Int>` and `any Iterable<Int>` into `any Iterable<Int?>`, `any Container<Int>`, and `any Indexable<Int, Int?>`', async () => {
    expect(
      await runMain(
        '(Array<Int>, Array<Int>, Bool, Int?)',
        [
          'const directIt: any Iterable<Int?> = [1, 2, 3]',
          'const narrowIt: any Iterable<Int> = [4, 5]',
          'const wideIt: any Iterable<Int?> = narrowIt',
          'const opts: Array<Int?> = [10, none, 20]',
          'const container: any Container<Int> = opts',
          'const indexed: any Indexable<Int, Int?> = [7, 8]',
          '([for x in directIt: x ?? 0], [for x in wideIt: (x ?? 0) * 10], 20 in container, indexed[1])',
        ].join('\n  '),
      ),
    ).toEqual([[1, 2, 3], [40, 50], true, 8]);
  });

  it('lowers `any Iterable<Int>` widened to `any Iterable<Int?>` without crashing', async () => {
    expect(
      await runMain(
        'Array<Int>',
        'const narrowIt: any Iterable<Int> = [4, 5]\n  const wideIt: any Iterable<Int?> = narrowIt\n  [for x in wideIt: (x ?? 0) * 10]',
      ),
    ).toEqual([40, 50]);
  });
});

describe('witnesses with defaults, generic requirements, generic witnesses, and literal receivers (§2, §3.10)', () => {
  it('supports witnesses with trailing default parameters in both direct and indirect `any` conversions', async () => {
    const decls = [
      ...baseTraits,
      'struct Stepper { start: Int }',
      'fn next(self: Stepper, step: Int = 5) -> Int: self.start + step',
    ];
    expect(
      await runMain(
        '(Int?, Int?)',
        [
          'const direct: any Source<Int?> = Stepper{start: 10}',
          'const narrow: any Source<Int> = Stepper{start: 20}',
          'const wide: any Source<Int?> = narrow',
          '(direct.next(), wide.next())',
        ].join('\n  '),
        decls,
      ),
    ).toEqual([15, 25]);
  });

  it('supports traits with generic required functions and generic witnesses through `any` variance', async () => {
    const decls = [
      'trait Mapper<T>:',
      '  fn mapWith<U>(self: Self, f: fn(T) -> U) -> Array<U>',
      'struct IntBox { x: Int }',
      'fn mapWith<V>(self: IntBox, f: fn(Int) -> V) -> Array<V>: [f(self.x)]',
    ];
    expect(
      await runMain(
        '(Array<Int>, Array<Int>)',
        [
          'const directMap: any Mapper<Int?> = IntBox{x: 4}',
          'const narrowMap: any Mapper<Int> = IntBox{x: 6}',
          'const wideMap: any Mapper<Int?> = narrowMap',
          '(directMap.mapWith(fn(v): (v ?? 0) + 1), wideMap.mapWith(fn(v): (v ?? 0) * 2))',
        ].join('\n  '),
        decls,
      ),
    ).toEqual([[5], [12]]);
  });

  it('allows a literal type to meet `any Source<Int?>` through its base type’s by-value witness (§2)', async () => {
    const decls = [...baseTraits, 'fn next(self: String) -> Int: self.length()'];
    expect(
      await runMain(
        'Int?',
        ['const tag: "draft" = "draft"', 'const s: any Source<Int?> = tag', 's.next()'].join(
          '\n  ',
        ),
        decls,
      ),
    ).toBe(5);
  });
});

describe('constrained and computed types meeting `any` through variance (§3.5, §3.10)', () => {
  it('converts associated types and keyed fields with trait bounds into `any` through variance', async () => {
    const decls = [
      ...baseTraits,
      'trait HasSource { type Data is Source<Int> }',
      'struct Boxed { v: Int }',
      'struct Holder { a: Boxed, type Data = Boxed }',
      'fn next(self: Boxed) -> Int: self.v',
      'fn fromAssociated<T is HasSource>(d: T.Data) -> any Source<Int?>: d',
      'fn fromKeyed<S is struct { [_] is Source<Int> }, K in keyof S>(s: S, k: K) -> any Source<Int?>: s[k]',
    ];
    expect(
      await runMain(
        '(Int?, Int?)',
        [
          'const b = Boxed{v: 33}',
          'const h = Holder{a: b}',
          '(fromAssociated<Holder>(b).next(), fromKeyed(h, "a").next())',
        ].join('\n  '),
        decls,
      ),
    ).toEqual([33, 33]);
  });

  it('converts type parameters with struct constraints or blanket witnesses into `any` through variance', async () => {
    const decls = [
      ...baseTraits,
      'trait Tag {}',
      'struct Tagged { v: Int, size: Int }',
      'fn next<T is Tag>(self: T) -> Int: 42',
      'fn fromStructConstraint<S is struct { size: Int }>(s: S) -> any Sized<Int?>: s',
      'fn fromBlanket<S is Tag>(s: S) -> any Source<Int?>: s',
    ];
    expect(
      await runMain(
        '(Int?, Int?)',
        [
          'const t = Tagged{v: 1, size: 9}',
          '(fromStructConstraint(t).size, fromBlanket(t).next())',
        ].join('\n  '),
        decls,
      ),
    ).toEqual([9, 42]);
  });
});

describe('several instantiations fitting, none closer (§3.10)', () => {
  const either = (first: string, second: string) => [
    ...baseTraits,
    'struct Either { k: Int }',
    first,
    second,
  ];
  const optional = 'fn put(self: Either, x: Int?) -> Int: (x ?? 0) + 100';
  const union = 'fn put(self: Either, x: Int | String) -> Int: 200';
  const body = [
    'const viaOpt: any Sink<Int?> = Either{k: 0}',
    'const viaUnion: any Sink<Int | String> = Either{k: 0}',
    'const sOpt: any Sink<Int> = viaOpt',
    'const sUnion: any Sink<Int> = viaUnion',
    'const found = match sUnion:',
    '    case Either as e: e.k + 1',
    '    case _: 0',
    '(sOpt.put(5), sUnion.put(5), found)',
  ].join('\n  ');

  it('refuses converting a value into an `any` type one of them stands for (5370)', () => {
    expect(codesOf(...either(optional, union), 'fn f() -> any Sink<Int>: Either{k: 0}')).toEqual([
      checkerDiagnostics.severalInstantiations.code,
    ]);
  });

  it('runs the first declared for a value another `any` type brought, and finds it by its type', async () => {
    expect(await runMain('(Int, Int, Int)', body, either(optional, union))).toEqual([105, 105, 1]);
    expect(await runMain('(Int, Int, Int)', body, either(union, optional))).toEqual([200, 200, 1]);
  });
});
