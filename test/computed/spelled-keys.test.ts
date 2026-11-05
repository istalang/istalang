/**
 * A type's spelled key (checker/types/type-keys.ts) holds everything the type is spelled with, so a
 * result kept by it never answers one spelling with another's (incremental-checking.md §1): every
 * way of writing one type differently — through an alias, an associated type or keys, at another
 * node, with an `any`'s traits or a union's members in another order, or reduced from a type
 * `match` use spelled so — keys apart, while the type's key stays one; and a type resolved from the
 * same nodes by another checker keys alike.
 */

import { describe, expect, it } from 'vitest';
import { checkedApart } from '../../src/compiler/checker/check.test-kit.ts';
import { typeKeys } from '../../src/compiler/checker/types/type-keys.ts';
import { sameTypeSpelled, unaliased } from '../../src/compiler/checker/types/type-parts.ts';
import type { FunctionDeclaration } from '../../src/compiler/syntax/declarations.ts';
import { resolveWrittenTypes } from './computed.test-kit.ts';

/** One type written two ways after `declarations`. */
interface Spelling {
  readonly name: string;
  readonly declarations: readonly string[];
  readonly first: string;
  readonly second: string;
}

const spellings: readonly Spelling[] = [
  { name: 'through an alias', declarations: ['type A = Int'], first: 'A', second: 'Int' },
  {
    name: 'through an associated type',
    declarations: ['struct F { type Data = Int }'],
    first: 'F.Data',
    second: 'Int',
  },
  {
    name: 'as keys',
    declarations: ['struct S { a: Int }'],
    first: 'keyof S',
    second: '"a"',
  },
  {
    name: 'as a shape at another node',
    declarations: [],
    first: '{ x: Int }',
    second: '{ x: Int }',
  },
  {
    name: "with an any's traits in another order",
    declarations: [
      'trait P:',
      '  fn p(self: Self) -> Int',
      'trait Q:',
      '  fn q(self: Self) -> Int',
    ],
    first: 'any P & Q',
    second: 'any Q & P',
  },
  {
    name: "with a union's members in another order",
    declarations: [],
    first: 'Int | String',
    second: 'String | Int',
  },
  {
    name: "with an alias's arguments at other nodes",
    declarations: ['type Many<T> = Array<T>'],
    first: 'Many<{ x: Int }>',
    second: 'Many<{ x: Int }>',
  },
  {
    name: 'as a mapped type',
    declarations: [],
    first: '{ [K in "a"]: Int }',
    second: '{ a: Int }',
  },
  {
    name: 'reduced from a type match use spelled at other nodes',
    declarations: [
      'struct Wrap<S> { s: S }',
      'struct Out<S> { s: S }',
      'type Pick<D> = match D:',
      '  case Wrap<infer S>: Out<S>',
    ],
    first: 'Pick<Wrap<{ x: Int }>>',
    second: 'Pick<Wrap<{ x: Int }>>',
  },
  { name: 'nested', declarations: ['type A = Int'], first: 'Array<A>', second: 'Array<Int>' },
];

describe('a spelled key', () => {
  it.each(spellings)('keys one type written $name apart', ({ declarations, first, second }) => {
    const { types, diagnosticCodes } = resolveWrittenTypes([first, second], declarations);
    const [one, other] = types;
    expect(diagnosticCodes).toEqual([]);
    expect(one && other && typeKeys.typeKey(one)).toBe(other && typeKeys.typeKey(other));
    expect(one && other && sameTypeSpelled(one, other)).toBe(false);
  });

  it.each(spellings)(
    'keys a type written $name alike when another checker resolves the same nodes',
    ({ declarations, first }) => {
      const { checker, types } = resolveWrittenTypes([first], declarations);
      const again = checkedApart(checker.program);
      const probe = [...again.program.modules.values()]
        .flatMap((module) => module.tree.root.items)
        .find(
          (item): item is FunctionDeclaration =>
            item.kind === 'FunctionDeclaration' && item.name.text === '_probe',
        );
      const [resolved] = probe === undefined ? [] : again.parametersOf(probe);
      const [type] = types;
      expect(type && resolved && typeKeys.spelledKey(type)).toBe(
        resolved && typeKeys.spelledKey(resolved.type),
      );
    },
  );
});

describe('a result kept for a type, computed from it as spelled', () => {
  it('answers each spelling with its own, as a JSON form does', () => {
    const { checker, types } = resolveWrittenTypes([
      'Array<{ x: Int }>',
      '{ x: Int }',
      '{ x: Int }',
    ]);
    const [, one, other] = types;
    for (const type of [one, other]) {
      expect(type && sameTypeSpelled(checker.json.formOf(type).type, unaliased(type))).toBe(true);
    }
  });
});
