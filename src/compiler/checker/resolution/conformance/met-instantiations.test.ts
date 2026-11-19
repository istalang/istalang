import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const traits = [
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

/** The codes reported checking `lines` after the traits above. */
function codesAfterTraits(...lines: readonly string[]): readonly number[] {
  return reported([...traits, ...lines].join('\n')).codes;
}

const mismatch = checkerDiagnostics.typeMismatch.code;

describe('the instantiation a type meets in an `any` type’s place (§8.3)', () => {
  it.each([
    [
      'what a requirement gives, for a trait giving it',
      ['struct Counter { n: Int }', 'fn next(self: Counter) -> Int: self.n'],
      'fn f() -> any Source<Int?>: Counter{n: 1}',
    ],
    [
      'what a requirement takes, for a trait taking it',
      ['struct Loose { k: Int }', 'fn put(self: Loose, x: Int?) -> Int: 1'],
      'fn f() -> any Sink<Int>: Loose{k: 1}',
    ],
    ['a required field', ['struct Box { size: Int }'], 'fn f() -> any Sized<Int?>: Box{size: 1}'],
    [
      'a generic witness, its own type parameters from the receiver',
      ['struct Wrap<U> { value: U }', 'fn next<U>(self: Wrap<U>) -> U: self.value'],
      'fn f() -> any Source<Int?>: Wrap{value: 1}',
    ],
    [
      'a type parameter’s declared constraint',
      [],
      'fn f<T is Source<Int>>(source: T) -> any Source<Int?>: source',
    ],
    [
      'another `any` type’s constraint',
      [],
      'fn f(source: any Source<Int>) -> any Source<Int?>: source',
    ],
  ])('finds it through %s', (_, declarations, use) => {
    expect(codesAfterTraits(...declarations, use)).toEqual([]);
  });

  it.each([
    ['a trait both giving and taking', 'fn f(cell: any Cell<Int>) -> any Cell<Int?>: cell'],
    ['a wider argument for one taking', 'fn f(sink: any Sink<Int>) -> any Sink<Int?>: sink'],
    ['a narrower one for one giving', 'fn f(source: any Source<Int?>) -> any Source<Int>: source'],
  ])('finds none for %s', (_, use) => {
    expect(codesAfterTraits(use)).toEqual([mismatch]);
  });

  it('refuses several that fit with none closer, naming them (5370)', () => {
    expect(
      codesAfterTraits(
        'struct Either { k: Int }',
        'fn put(self: Either, x: Int?) -> Int: 1',
        'fn put(self: Either, x: Int | String) -> Int: 2',
        'fn f() -> any Sink<Int>: Either{k: 0}',
      ),
    ).toEqual([checkerDiagnostics.severalInstantiations.code]);
  });

  it('finds a generic witness whose type parameter a function type it is given takes', () => {
    expect(
      reported(
        [
          'trait Transformer<T>:',
          '  fn transform(self: Self, pair: (Int, fn(T) -> Int)) -> T',
          'struct Gen { k: Int }',
          'fn transform<V>(self: Gen, pair: (V, fn(V) -> Int)) -> V: pair.0',
          'fn f(x: Int?) -> Int: 7',
          'fn direct(gen: Gen) -> Int: transform(gen, (3, f))',
          'fn wider(gen: Gen) -> any Transformer<Int?>: gen',
          'fn widened(a: any Transformer<Int>) -> any Transformer<Int?>: a',
        ].join('\n'),
      ).codes,
    ).toEqual([]);
  });

  it('takes the closest of several that fit', () => {
    expect(
      reported(
        [
          'trait Each<T>:',
          '  fn each(self: Self, f: fn(T) -> Unit)',
          'struct Both { k: Int }',
          'fn each(self: Both, f: fn(Int) -> Unit): f(1)',
          'fn each(self: Both, f: fn(Int?) -> Unit): f(none)',
          'fn f() -> any Each<Int? | String>: Both{k: 0}',
        ].join('\n'),
      ).codes,
    ).toEqual([]);
  });

  it('keeps a union’s `any` member from taking a member meeting it only through variance', () => {
    expect(
      codesAfterTraits(
        'struct Counter { n: Int }',
        'fn next(self: Counter) -> Int: self.n',
        'fn f(c: Counter) -> Counter | any Source<Int?>: c',
        'fn g(c: Counter) -> any Source<Int?>: c',
      ),
    ).toEqual([]);
  });
});

/** Types a property relates pairwise: literals, optionals, unions and containers of them. */
const pool = ['Int', 'Int?', '"a"', 'String', 'Int | String', 'Array<Int>', 'Array<Int?>'];

/**
 * For each pair of the pool, whether a value of the first fits the second, and whether `any
 * Source<…>` and `any Sink<…>` of the first fit those of the second: one program, a function per
 * question, each reported or not by the line it is on.
 */
function fitsPairwise(): readonly {
  readonly found: string;
  readonly expected: string;
  readonly plain: boolean;
  readonly source: boolean;
  readonly sink: boolean;
}[] {
  const pairs = pool.flatMap((found) => pool.map((expected) => ({ found, expected })));
  const lines = [
    ...traits,
    ...pairs.flatMap(({ found, expected }, index) => [
      `fn plain${index}(x: ${found}) -> ${expected}: x`,
      `fn source${index}(x: any Source<${found}>) -> any Source<${expected}>: x`,
      `fn sink${index}(x: any Sink<${found}>) -> any Sink<${expected}>: x`,
    ]),
  ];
  const text = lines.join('\n');
  const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': text }), 'main.ista');
  const failing = new Set(
    diagnostics.map(({ span }) => text.slice(0, span.start).split('\n').length - 1),
  );
  return pairs.map(({ found, expected }, index) => {
    const line = traits.length + index * 3;
    return {
      found,
      expected,
      plain: !failing.has(line),
      source: !failing.has(line + 1),
      sink: !failing.has(line + 2),
    };
  });
}

describe('variance through `any` (§8.3)', () => {
  it('relates `any` types of a giving trait as their arguments fit, and of a taking one reversed', () => {
    const answers = fitsPairwise();
    const reversed = new Map(answers.map((each) => [`${each.expected}→${each.found}`, each.plain]));
    for (const { found, expected, plain, source, sink } of answers) {
      expect({ found, expected, source }).toEqual({ found, expected, source: plain });
      expect({ found, expected, sink }).toEqual({
        found,
        expected,
        sink: reversed.get(`${found}→${expected}`),
      });
    }
  });
});
