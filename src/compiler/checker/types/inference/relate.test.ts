/**
 * Inference through a conversion into an `any` type (§3.5, §3.10): a value holding variables, or
 * one converted into an `any` type holding them, relates through the instantiation its type may
 * meet, each argument as the trait's variance says, so neither side's type arguments need writing;
 * what can't be told before the variables settle gives nothing, and is judged once they do.
 */

import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../compile.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const declarations = [
  'trait View<S>:',
  '  fn draw(self: Self, s: S) -> Int',
  'struct Layout<S>:',
  '  f: fn(S) -> Int',
  '  kids: Array<any View<S>> = []',
  'fn draw<S>(self: Layout<S>, s: S) -> Int:',
  '  let total = self.f(s)',
  '  for kid in self.kids:',
  '    total = total + kid.draw(s)',
  '  total',
  'struct Scope { a: Int }',
  'fn takes<S>(v: any View<S>, s: S) -> Int: v.draw(s)',
];

const tree =
  'fn tree(): Layout<Scope>{ f: fn(s: Scope): s.a, kids: [Layout{ f: fn(s): s.a * 10 }] }';

/** What `main` gives after the declarations above and `functions`. */
function outcome(body: string, ...functions: readonly string[]): unknown {
  const source = [
    ...declarations,
    ...functions,
    'async fn main() -> Future<Int>:',
    `  ${body}`,
  ].join('\n');
  const state = startToEnd(testRuntime(), compiledText(source));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

/** The codes reported for the declarations above and `functions`. */
function codesAfter(...functions: readonly string[]): readonly number[] {
  return reported([...declarations, ...functions, 'async fn main(): 0'].join('\n')).codes;
}

describe('a conversion into an `any` type while inferring', () => {
  it('bounds the variables of a literal converted into an `any` type it meets', () => {
    expect(codesAfter(tree)).toEqual([]);
    expect(outcome('tree().draw(Scope{a: 2})', tree)).toBe(22);
  });

  it("bounds the variables of the `any` type a value converts into by what the value's type meets", () => {
    expect(outcome('takes(tree(), Scope{a: 2})', tree)).toBe(22);
  });

  it("proposes what a witness's signature makes, judging its own constraints once settled", () => {
    const conditional = [
      'trait Tag:',
      '  fn tag(self: Self) -> Int',
      'struct Box<T> { x: T }',
      'fn draw<T is Tag>(self: Box<T>, s: T) -> Int: 1',
      'fn tagged() -> Int: takes(Box{x: Scope{a: 1}}, Scope{a: 2})',
    ];
    expect(codesAfter(...conditional)).toEqual([checkerDiagnostics.notConforming.code]);
    expect(codesAfter(...conditional, 'fn tag(self: Scope) -> Int: 0')).toEqual([]);
  });

  it('makes a value holding variables the instantiation its witness is declared for', () => {
    const declared = ['struct Box<T> { x: T }', 'fn draw(self: Box<Scope>, s: Scope) -> Int: s.a'];
    expect(outcome('takes(Box{x: Scope{a: 1}}, Scope{a: 2})', ...declared)).toBe(2);
  });

  it('infers what only the instantiation its witness is declared for gives', () => {
    const declared = ['struct Box<T> { x: T? }', 'fn draw(self: Box<Scope>, s: Scope) -> Int: s.a'];
    expect(outcome('takes(Box{x: none}, Scope{a: 2})', ...declared)).toBe(2);
  });

  it('gives nothing where the type meets several instantiations, the other arguments deciding', () => {
    const both = [
      'struct Both {}',
      'fn draw(self: Both, s: Int) -> Int: 3',
      'fn draw(self: Both, s: String) -> Int: 4',
    ];
    expect(outcome('takes(Both, "s")', ...both)).toBe(4);
  });

  it('relates through the one instantiation that relates, and chooses no overload none does', () => {
    const overloads = [
      'struct Both {}',
      'fn draw(self: Both, s: Int) -> Int: 1',
      'fn draw(self: Both, s: (String, Int)) -> Int: 2',
      'fn takesPair<T>(v: any View<(String, T)>) -> Int: 0',
      'fn f<T>(v: any View<(String, T)>, x: T) -> Int: 5',
      'fn f<T>(v: { a: Int }, x: T) -> Int: 6',
      'fn g<S>(v: any View<S>, s: S) -> Int: 7',
      'fn g<T>(v: { x: T }, s: Int) -> Int: 8',
      'struct Held { a: Int }',
      'fn draw(self: Held, s: Int) -> Int: 3',
      'fn draw(self: Held, s: Bool) -> Int: 4',
      'struct Box<T> { x: T }',
    ];
    expect(
      ['takesPair(Both)', 'f(Held{a: 1}, 1)', 'g(Box{x: 1}, 2)'].map((call) =>
        outcome(call, ...overloads),
      ),
    ).toEqual([0, 6, 8]);
  });

  it('binds a member parameter through the instantiation its value may meet', () => {
    expect(
      codesAfter(
        'trait Source<T>:',
        '  fn next(self: Self) -> T',
        'type Key = "a"',
        'struct Pick<K in Key> { f: fn(K) -> String }',
        'fn next<K in Key>(self: Pick<K>) -> K: self.next()',
        'fn picked() -> any Source<"a">: Pick{ f: fn(x): x }',
      ),
    ).toEqual([]);
  });

  it('tries each member of an expected union alone, whichever is written first', () => {
    const union = (members: string) => [
      'trait ViewB<S>:',
      '  fn drawB(self: Self, s: S) -> Int',
      'struct Both {}',
      'fn draw(self: Both, s: Int) -> Int: 5',
      'fn drawB(self: Both, s: String) -> Int: 6',
      `fn pick<S>(v: ${members}, s: S) -> Int: 0`,
      'fn picked() -> Int: pick(Both, "s")',
    ];
    expect(codesAfter(...union('any View<S> | any ViewB<S>'))).toEqual(
      codesAfter(...union('any ViewB<S> | any View<S>')),
    );
  });

  it('gives nothing where the type meets no instantiation of the trait, which then misfits', () => {
    expect(codesAfter('struct Plain {}', 'fn f() -> Int: takes(Plain, 1)')).toEqual([
      checkerDiagnostics.typeMismatch.code,
    ]);
  });

  it('relates a contravariant receiver and an `any` value by the trait variance in either argument order', () => {
    const varied = [
      'type ScopeShape = { a: Int }',
      'fn directLayout() -> Layout<ScopeShape>: Layout<ScopeShape>{ f: fn(s: ScopeShape): s.a }',
      'fn directShape() -> any View<ScopeShape>: directLayout()',
      'fn pick<S>(v: any View<S>, s: S) -> S: s',
      'fn pickRev<S>(s: S, v: any View<S>) -> S: s',
      'fn chosen() -> (Scope, Scope, Scope):',
      '  (pick(directLayout(), Scope{a: 1}), pick(directShape(), Scope{a: 2}), pickRev(Scope{a: 3}, directLayout()))',
    ];
    expect(codesAfter(...varied)).toEqual([]);
    expect(outcome('{ const a, b, c = chosen(); a.a + b.a * 10 + c.a * 100 }', ...varied)).toBe(
      321,
    );
  });

  it('joins a covariant trait bound with `none` in either argument order, for concrete and `any` sources', () => {
    const sources = [
      'trait Source<T>:',
      '  fn next(self: Self) -> T',
      'struct IntSource { n: Int }',
      'fn next(self: IntSource) -> Int: self.n',
      'fn takes1<T>(s: any Source<T>, x: T) -> T: x',
      'fn takes2<T>(x: T, s: any Source<T>) -> T: x',
      'fn fromConcrete(s: IntSource) -> (Int?, Int?): (takes1(s, none), takes2(none, s))',
      'fn fromAny(s: any Source<Int>) -> (Int?, Int?): (takes1(s, none), takes2(none, s))',
    ];
    expect(codesAfter(...sources)).toEqual([]);
  });

  it('infers through a trait whose receiver parameter defaults to `Self` (`Iterable<T, C = Self>`)', () => {
    const iterables = [
      'struct Bag<T> { items: Array<T> = [] }',
      'fn iterate<T>(self: Bag<T>) -> fn() -> Step<T>: self.items.iterate()',
      'fn emptyBag() -> any Iterable<Int>: Bag{}',
      'fn firstOf<T>(xs: any Iterable<T>) -> T?:',
      '  for x in xs:',
      '    return x',
      '  none',
    ];
    expect(codesAfter(...iterables)).toEqual([]);
    expect(outcome('(firstOf([7, 8]) ?? 0) + (firstOf(emptyBag()) ?? 1)', ...iterables)).toBe(8);
  });
});
