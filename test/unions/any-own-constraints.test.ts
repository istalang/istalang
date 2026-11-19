/**
 * A type meeting `any Trait<B>` through constraints it carries of another trait (§8.3): a type
 * parameter's or an `any` type's own requirements stand as witnesses, and a keyed field meets what
 * every field it may name meets, an exact type by its own witnesses.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, runMain } from '../written-types.test-kit.ts';

const baseTraits = [
  'trait Source<T>:',
  '  fn next(self: Self) -> T',
  'trait Sink<T>:',
  '  fn put(self: Self, x: T) -> Int',
];

describe('a type meeting `any` through its own constraints of another trait (§8.3)', () => {
  const decls = [
    ...baseTraits,
    'trait MySource<T>:',
    '  fn next(self: Self) -> T',
    'struct Counter { n: Int }',
    'fn next(self: Counter) -> Int: self.n',
    'fn direct<T is MySource<Int>>(x: T) -> any Source<Int?>: x',
    'fn directAny(x: any MySource<Int>) -> any Source<Int?>: x',
  ];

  it('converts a type parameter and an `any` type through the requirement they carry', async () => {
    expect(
      await runMain(
        '(Int?, Int?)',
        '(direct(Counter{n: 1}).next(), directAny(Counter{n: 2}).next())',
        decls,
      ),
    ).toEqual([1, 2]);
  });

  it("converts a keyed field whose struct constraint names a field beside its '[_]' entry", async () => {
    const keyed = [
      ...baseTraits,
      'struct Boxed { n: Int }',
      'struct Other { m: Int }',
      'fn next(self: Boxed) -> Int: self.n',
      'fn next(self: Other) -> Int: self.m * 10',
      'struct Pair { a: Boxed, b: Other }',
      'fn named<S is struct { a: Boxed, [_] is Source<Int> }, K in keyof S>(s: S, k: K) -> any Source<Int>: s[k]',
    ];
    const body =
      'const p = Pair{a: Boxed{n: 3}, b: Other{m: 4}}\n  (named(p, "a").next(), named(p, "b").next())';
    expect(await runMain('(Int, Int)', body, keyed)).toEqual([3, 40]);
  });
});

describe('a keyed field meeting a trait whose arguments mention `Self`', () => {
  it('meets it as each exact field type does, `Self` that type', () => {
    expect(
      codesOf(
        'trait Orderable<T = Self>:',
        '  fn rank(self: Self, other: T) -> Int',
        'struct Boxed { n: Int }',
        'fn rank(self: Boxed, other: Boxed) -> Int: 0',
        'fn ranked<S is struct { a: Boxed, [_] is Orderable }, K in keyof S>(s: S, k: K) -> Int: s[k].rank(s[k])',
      ),
    ).toEqual([]);
  });
});

describe('an `any` type meeting several instantiations, none closer', () => {
  it('refuses an `any` type whose traits each meet one of them (5370)', () => {
    const traits = [
      ...baseTraits,
      'trait OptSink:',
      '  fn put(self: Self, x: Int?) -> Int',
      'trait WideSink:',
      '  fn put(self: Self, x: Int | String) -> Int',
      'fn f(x: any OptSink & WideSink) -> any Sink<Int>: x',
    ];
    expect(codesOf(...traits)).toEqual([checkerDiagnostics.severalInstantiations.code]);
  });
});
