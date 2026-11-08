import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { programModule } from '../../../program/program.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { checkedApart } from '../../check.test-kit.ts';
import type { Type } from '../type/index.ts';
import { errorType } from '../type/primitives.ts';
import type { Variance } from './lattice.ts';
import type { VariedDeclaration } from './variance.ts';

const variedKinds: ReadonlySet<string> = new Set([
  'StructDeclaration',
  'SharedStructDeclaration',
  'EnumDeclaration',
  'ExternStructDeclaration',
  'TypeAliasDeclaration',
  'TraitDeclaration',
]);

/** The variance of each type parameter of each nominal declaration `text` declares, by name. */
function variancesIn(text: string): ReadonlyMap<string, readonly Variance[]> {
  const program = stdProgramOf({ 'main.ista': text });
  const checker = checkedApart(program);
  const { items } = programModule(program, idOf('main.ista')).tree.root;
  return new Map(
    items
      .filter((item): item is VariedDeclaration => variedKinds.has(item.kind))
      .map((item) => [item.name.text, checker.fitting.varianceOf(item)] as const),
  );
}

describe('a declaration’s variance (§3.5)', () => {
  it.each([
    ['struct Box<T> { value: T }', 'Box', ['covariant']],
    ['struct Sink<T> { take: fn(T) -> Unit }', 'Sink', ['contravariant']],
    ['struct Both<T> { value: T, take: fn(T) -> Unit }', 'Both', ['invariant']],
    ['struct Phantom<T> { n: Int }', 'Phantom', ['covariant']],
    ['struct Twice<T> { take: fn(fn(T) -> Unit) -> Unit }', 'Twice', ['covariant']],
    ['struct Changing<T> { change: fn(&T) -> Unit }', 'Changing', ['invariant']],
    ['struct Held<T> { slot: Slot<T> }', 'Held', ['invariant']],
    ['struct Listed<T> { items: Array<T>, by: Map<T, Int> }', 'Listed', ['invariant']],
    ['struct Valued<K, V> { by: Map<K, V> }', 'Valued', ['invariant', 'covariant']],
    ['enum Opt<T> { Some(value: T), None }', 'Opt', ['covariant']],
    ['struct Node<T> { value: T, children: Array<Node<T>> }', 'Node', ['covariant']],
    ['struct Loop<T> { f: fn(Loop<T>) -> Unit }', 'Loop', ['invariant']],
    [
      'struct Phantom<T> { n: Int }\nstruct Outer<T> { p: Phantom<T>, f: fn(T) -> Unit }',
      'Outer',
      ['invariant'],
    ],
    [
      'struct Phantom<T> { n: Int }\nstruct Taker<T> { f: fn(Phantom<T>) -> Unit }',
      'Taker',
      ['contravariant'],
    ],
    [
      'struct Ping<T> { pong: Array<Pong<T>> }\nstruct Pong<T> { take: fn(T) -> Unit, ping: Ping<T>? }',
      'Ping',
      ['contravariant'],
    ],
    [
      'type Tree<T> = T | Array<Tree<T>>\nstruct Grove<T> { tree: Tree<T> }',
      'Grove',
      ['covariant'],
    ],
    ['type Status = "a" | "b"\nstruct Tagged<S in Status> { tag: S }', 'Tagged', ['invariant']],
    ['shared struct Cell<T>:\n  value: T', 'Cell', ['invariant']],
    [
      'extern struct Host<gives A, takes B, C>',
      'Host',
      ['covariant', 'contravariant', 'invariant'],
    ],
    ['struct Asserted<gives T> { n: Int }', 'Asserted', ['covariant']],
    ['type Pairs<A, B> = Array<(A, fn(B) -> Unit)>', 'Pairs', ['covariant', 'contravariant']],
    ['trait Source<T> { fn next(self: Self) -> T }', 'Source', ['covariant']],
    ['trait Sink<T> { fn put(self: Self, x: T) -> Unit }', 'Sink', ['contravariant']],
    ['trait Cell<T> { fn get(self: Self) -> T; fn set(self: Self, x: T) }', 'Cell', ['invariant']],
    ['trait Sized<T> { size: T }', 'Sized', ['covariant']],
    ['trait Later<T> { async fn later(self: Self) -> Future<T> }', 'Later', ['covariant']],
    ['trait Swaps<T> { fn swap(self: &Self, x: &T) }', 'Swaps', ['invariant']],
    ['trait Each<T> { fn each(self: Self, f: fn(T) -> Unit) }', 'Each', ['covariant']],
    ['trait Tag<T> { fn tag(self: Self) -> Int }', 'Tag', ['covariant']],
    [
      'trait Source<T> { fn next(self: Self) -> T }\nstruct Wrapped<T> { s: any Source<T> }',
      'Wrapped',
      ['covariant'],
    ],
    [
      'trait Feed<T> { fn next(self: Self) -> Bag<T> }\nstruct Bag<T> { take: fn(T) -> Unit, feed: (any Feed<T>)? }',
      'Feed',
      ['contravariant'],
    ],
  ] as const)('of %j is %j: %j', (text, name, expected) => {
    expect(variancesIn(text).get(name)).toEqual(expected);
  });
});

/** A field type built around `T`, and where `T` stands in it, as a fresh oracle computes it. */
interface Built {
  readonly text: string;
  readonly at: 'covariant' | 'contravariant' | 'invariant' | 'unused';
}

const flip = { covariant: 'contravariant', contravariant: 'covariant' } as const;

/** Wraps `inner` once: in a position keeping, flipping, or fixing where `T` stands. */
function wrapping(
  inner: Built,
  how: 'array' | 'tuple' | 'optional' | 'parameter' | 'result' | 'slot',
): Built {
  switch (how) {
    case 'array':
      return { text: `Array<${inner.text}>`, at: inner.at };
    case 'tuple':
      return { text: `(Int, ${inner.text})`, at: inner.at };
    case 'optional':
      return { text: `(${inner.text})?`, at: inner.at };
    case 'result':
      return { text: `fn() -> ${inner.text}`, at: inner.at };
    case 'parameter':
      return {
        text: `fn(${inner.text}) -> Unit`,
        at: inner.at === 'covariant' || inner.at === 'contravariant' ? flip[inner.at] : inner.at,
      };
    default:
      return { text: `Slot<${inner.text}>`, at: inner.at === 'unused' ? 'unused' : 'invariant' };
  }
}

const built: fc.Arbitrary<Built> = fc
  .array(fc.constantFrom('array', 'tuple', 'optional', 'parameter', 'result', 'slot' as const), {
    maxLength: 5,
  })
  .chain((wraps) =>
    fc
      .constantFrom<Built>({ text: 'T', at: 'covariant' }, { text: 'Int', at: 'unused' })
      .map((leaf) => wraps.reduce(wrapping, leaf)),
  );

/** Where `T` stands across several fields: the least position above each. */
function joined(positions: readonly Built['at'][]): Variance {
  const used = new Set(positions.filter((at) => at !== 'unused'));
  if (used.size === 0) {
    return 'covariant';
  }
  return used.size === 1 ? ([...used][0] as Variance) : 'invariant';
}

describe('deriving a struct’s variance', () => {
  it('agrees with where its fields put the parameter', () => {
    fc.assert(
      fc.property(fc.array(built, { minLength: 1, maxLength: 3 }), (fields) => {
        const declared = fields.map((field, index) => `f${index}: ${field.text}`).join(', ');
        expect(variancesIn(`struct S<T> { ${declared} }`).get('S')).toEqual([
          joined(fields.map((field) => field.at)),
        ]);
      }),
      { numRuns: 60 },
    );
  });
});

/** A field's type built of `T`, `Int`, `S` itself and a phantom's use, wrapped in any position. */
const held: fc.Arbitrary<string> = fc.letrec<{ type: string }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom('T', 'Int', 'Phantom<T>'),
    tie('type').map((inner) => `Array<S<${inner}>>`),
    tie('type').map((inner) => `Array<${inner}>`),
    tie('type').map((inner) => `fn(${inner}) -> Unit`),
    tie('type').map((inner) => `fn() -> ${inner}`),
    tie('type').map((inner) => `Slot<${inner}>`),
    tie('type').map((inner) => `(Int, ${inner})`),
  ),
})).type;

/** The types `probe`'s two parameters have in `text`, and the checker of its program. */
function probed(text: string) {
  const program = stdProgramOf({ 'main.ista': text });
  const checker = checkedApart(program);
  const probe = programModule(program, idOf('main.ista')).tree.root.items.find(
    (item): item is FunctionDeclaration => item.kind === 'FunctionDeclaration',
  );
  const types = probe === undefined ? [] : checker.parametersOf(probe).map(({ type }) => type);
  return { checker, types };
}

/** The fields of a value of `from` that don't fit `to`'s, where the value itself fits. */
function misfitFields(checker: ReturnType<typeof probed>['checker'], from: Type, to: Type) {
  if (checker.fitOf(from, to) === undefined) {
    return [];
  }
  const targets = checker.fieldsOf(to) ?? [];
  return (checker.fieldsOf(from) ?? []).filter(
    (field, index) => checker.fitOf(field.type, targets[index]?.type ?? field.type) === undefined,
  );
}

describe('a derived variance', () => {
  it('lets a value fit only where each of its fields fits the other’s, as lowering rebuilds it', () => {
    fc.assert(
      fc.property(fc.array(held, { minLength: 1, maxLength: 3 }), (fields) => {
        const declared = fields.map((field, index) => `f${index}: ${field}`).join(', ');
        const { checker, types } = probed(
          [
            'struct Phantom<T> { n: Int }',
            `struct S<T> { ${declared} }`,
            'fn probe(narrow: S<Int>, wide: S<Int?>): ()',
          ].join('\n'),
        );
        const [narrow = errorType, wide = errorType] = types;
        expect(misfitFields(checker, narrow, wide).map(({ name }) => name)).toEqual([]);
        expect(misfitFields(checker, wide, narrow).map(({ name }) => name)).toEqual([]);
      }),
      { numRuns: 80 },
    );
  });
});
