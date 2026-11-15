/**
 * A type's table key (names.ts) is its identity as a Definition persists it: types of distinct keys
 * have distinct table keys, whatever attribute tells them apart (`&`, sendability, a function's
 * kind, grouping in a union, recursion), so a union orders its variants by them and names each by
 * one alike however it was written, and a program's Definition doesn't depend on the modules beside
 * it (docs/arch/definition.md, "Types and locations").
 */

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { resolveWrittenTypes } from '../../../../test/written-types.test-kit.ts';
import { definitionFormat } from '../../../definition/definition.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { compiledDefinition } from '../../compile.test-kit.ts';
import { tableKey } from './names.ts';

/** Declarations the written types below name. */
const declarations = [
  'struct Box<T>:\n  v: T',
  'trait Peer<T = Self>:\n  fn peer(self: Self) -> Int',
  'type Tree = Int | Array<Tree>',
  'type Calls = Int | Array<fn(&Calls) -> Int>',
  'type Plain = Int | Array<fn(Calls) -> Int>',
];

/** A type written alone, needing no parentheses around it. */
const leaf = fc.constantFrom(
  'Int',
  'String',
  'None',
  '"a"',
  '1',
  'any Peer',
  'any Peer<Int>',
  'Tree',
  'Calls',
  'Plain',
);

/** A type's structure, its function types' `&`, sendability and kind left to `render`. */
type Skeleton =
  | { readonly kind: 'leaf'; readonly name: string }
  | { readonly kind: 'generic'; readonly head: 'Array' | 'Box'; readonly of: Skeleton }
  | { readonly kind: 'tuple'; readonly elements: readonly Skeleton[] }
  | { readonly kind: 'shape'; readonly of: Skeleton }
  | { readonly kind: 'union'; readonly members: readonly Skeleton[] }
  | {
      readonly kind: 'function';
      readonly parameters: readonly Skeleton[];
      readonly result: Skeleton;
    };

const skeleton: fc.Arbitrary<Skeleton> = fc.letrec<{ type: Skeleton }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leaf.map((name) => ({ kind: 'leaf' as const, name })),
    fc.record({
      kind: fc.constant('generic' as const),
      head: fc.constantFrom('Array' as const, 'Box' as const),
      of: tie('type'),
    }),
    fc.record({
      kind: fc.constant('tuple' as const),
      elements: fc.array(tie('type'), { minLength: 2, maxLength: 2 }),
    }),
    fc.record({ kind: fc.constant('shape' as const), of: tie('type') }),
    fc.record({
      kind: fc.constant('union' as const),
      members: fc.array(tie('type'), { minLength: 2, maxLength: 3 }),
    }),
    fc.record({
      kind: fc.constant('function' as const),
      parameters: fc.array(tie('type'), { maxLength: 2 }),
      result: tie('type'),
    }),
  ),
})).type;

const sends = ['plain', 'sendable', 'inert'] as const;
const marks = ['simple', 'live', 'ista'] as const;

/** A function type written either by its head or as `Fn<Args, Result, Kind, Send>`. */
function renderFunction(
  slots: readonly string[],
  result: string,
  choose: (count: number) => number,
): string {
  const send = sends[choose(sends.length)] ?? 'plain';
  const mark = marks[choose(marks.length)] ?? 'simple';
  if (choose(2) === 1) {
    const packTuple = `(${slots.join(', ')}${slots.length === 1 ? ',' : ''})`;
    return `Fn<${packTuple}, ${result}, "${mark}", "${send}">`;
  }
  const head = `${send === 'plain' ? '' : `${send} `}${mark === 'simple' ? '' : `${mark} `}fn`;
  return `${head}(${slots.join(', ')}) -> (${result})`;
}

/**
 * `shape` written, each attribute it leaves open taken in turn from `choices`, and each type
 * another holds grouped, so none parses as a different one.
 */
function render(shape: Skeleton, choices: readonly number[]): string {
  let taken = 0;
  const choose = (count: number): number => {
    const choice = choices[taken % choices.length] ?? 0;
    taken += 1;
    return choice % count;
  };
  const write = (each: Skeleton): string => {
    switch (each.kind) {
      case 'leaf':
        return each.name;
      case 'generic':
        return `${each.head}<${write(each.of)}>`;
      case 'tuple':
        return `(${each.elements.map(write).join(', ')})`;
      case 'shape':
        return `{ a: ${write(each.of)} }`;
      case 'union':
        return each.members.map((member) => `(${write(member)})`).join(' | ');
      case 'function': {
        const slots = each.parameters.map(
          (parameter) => `${choose(2) === 1 ? '&' : ''}${write(parameter)}`,
        );
        return renderFunction(slots, write(each.result), choose);
      }
      default: {
        const unhandled: never = each;
        return unhandled;
      }
    }
  };
  return write(shape);
}

/** Types alike in structure, several of them written with other attributes each. */
const written = fc
  .tuple(
    fc.array(skeleton, { minLength: 1, maxLength: 4 }),
    fc.array(fc.array(fc.nat(), { minLength: 1, maxLength: 6 }), { minLength: 2, maxLength: 3 }),
  )
  .map(([skeletons, choices]) => [
    ...new Set(skeletons.flatMap((each) => choices.map((chosen) => render(each, chosen)))),
  ]);

describe('table keys', () => {
  it('tell apart every two types of distinct keys, and are one for types of one key', () => {
    fc.assert(
      fc.property(written, (texts) => {
        const { checker, types, diagnosticCodes } = resolveWrittenTypes(texts, declarations);
        expect(diagnosticCodes).toEqual([]);
        const keys = types.map((type) => checker.typeKeys.typeKey(type));
        const tableKeys = types.map((type) => tableKey(checker, type));
        keys.forEach((key, first) => {
          keys.forEach((other, second) => {
            expect(tableKeys[first] === tableKeys[second]).toBe(key === other);
          });
        });
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  it('memoizes the table key per type key', () => {
    const { checker, types, diagnosticCodes } = resolveWrittenTypes(
      ['Int | String', 'String | Int', 'Tree', 'Int | Array<Tree>'],
      declarations,
    );
    expect(diagnosticCodes).toEqual([]);
    const spy = vi.spyOn(checker.typeKeys, 'keyWith');
    const [unionA, unionB, foldedTree, unfoldedTree] = types;
    const firstUnion = tableKey(checker, unionA ?? unreachable('Written.'));
    const callsAfterFirstUnion = spy.mock.calls.length;
    expect(tableKey(checker, unionB ?? unreachable('Written.'))).toBe(firstUnion);
    expect(spy).toHaveBeenCalledTimes(callsAfterFirstUnion);
    const firstTree = tableKey(checker, foldedTree ?? unreachable('Written.'));
    const callsAfterFirstTree = spy.mock.calls.length;
    expect(tableKey(checker, unfoldedTree ?? unreachable('Written.'))).toBe(firstTree);
    expect(spy).toHaveBeenCalledTimes(callsAfterFirstTree);
  });
});

/** A function type `P` and `R`, which differs from it in `difference`, both in one union. */
function functionUnion(difference: string): string {
  return `type P = fn(Int) -> Int
type R = ${difference}
fn a(f: P) -> P | R: f
fn b(x: R | P) -> Bool:
  match x:
    case P: true
    case _: false
fn c(x: P | R) -> Bool:
  match x:
    case P: true
    case _: false`;
}

/** `Box`es of a union of function types, and of a function type giving a union. */
const boxes = `struct Box<T>:
  v: T
type U = (fn() -> Int) | (fn() -> String)
type F = fn() -> Int | (fn() -> String)
type BU = Box<U>
type BF = Box<F>`;

describe('a union whose members differ only in what its table key tells apart', () => {
  it.each(['inert fn(Int) -> Int', 'sendable fn(Int) -> Int', 'fn(&Int) -> Int'])(
    'orders its variants alike however written, with %s',
    async (difference) => {
      const body = 'const f: P = fn(n: Int) -> Int: n\n(b(a(f)), c(a(f)))';
      expect(await mainGives('(Bool, Bool)', body, functionUnion(difference))).toEqual([
        true,
        true,
      ]);
    },
  );

  it('orders its variants alike however written, a member a union of function types', async () => {
    const matches = `fn a(x: BU) -> BU | BF: x
fn b(x: BF | BU) -> Bool:
  match x:
    case BU: true
    case _: false
fn c(x: BU | BF) -> Bool:
  match x:
    case BU: true
    case _: false`;
    const body = 'const u: U = fn() -> Int: 1\nconst x: BU = Box { v: u }\n(b(a(x)), c(a(x)))';
    expect(await mainGives('(Bool, Bool)', body, `${boxes}\n${matches}`)).toEqual([true, true]);
  });

  it('reads each element back as its own member through a native', async () => {
    const which = `fn which(x: (BU | BF)?) -> String:
  match x:
    case None: "none"
    case BU: "BU"
    case _: "BF"`;
    const body = [
      'const u: U = fn() -> Int: 1',
      'const f: F = fn() -> Int: 2',
      'const xs: Array<BU | BF> = [Box { v: u }, Box { v: f }]',
      '(which(xs.at(0)), which(xs.at(1)))',
    ].join('\n');
    expect(await mainGives('(String, String)', body, `${boxes}\n${which}`)).toEqual(['BU', 'BF']);
  });
});

/** A program reading a recursive union, written through an alias of its own. */
const tree = `type Tree<T> = T | Array<Tree<T>>
fn count(t: Tree<Int>) -> Int:
  match t:
    case Array<Tree<Int>>: 2
    case _: 1
live async fn main() -> Int: count([1, [2]])`;

/** A module importing that program, declaring its recursive union through an alias spelled before it. */
const another = `import count from 'main.ista'
type Arbor<T> = T | Array<Arbor<T>>
fn grow(t: Arbor<Int>) -> Int: count(t)`;

describe("a program's Definition", () => {
  it('is the same alone as beside modules it never imports', () => {
    const text = (modules: Record<string, string>) =>
      definitionFormat.write(compiledDefinition(stdProgramOf(modules), 'main.ista')).text;
    expect(text({ 'a.ista': another, 'main.ista': tree })).toBe(text({ 'main.ista': tree }));
  });
});
