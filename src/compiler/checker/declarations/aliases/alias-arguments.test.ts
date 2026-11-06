/**
 * An alias's use guards its type arguments only where the alias's body does (§3.17): a nominal
 * type's arguments are guarded, a transparent alias's only where its body uses that parameter
 * guarded, a type `match` alias's only where every case does and no case inspects it. A recursive
 * alias reaching itself only through unguarded arguments names no type, reported as one reaching
 * itself directly is.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const aliasCycle = checkerDiagnostics.aliasCycle('' as never, '').code;

/** The codes checking `declarations` and a function taking an `A` reports. */
function codesOf(...declarations: readonly string[]): readonly number[] {
  return reported([...declarations, 'fn f(x: A) -> Int: 0'].join('\n')).codes;
}

describe("an alias's type arguments", () => {
  it.each([
    ['a transparent alias giving it whole', ['type Id<T> = T', 'type A = Id<A>']],
    ['a transparent alias putting it in a union', ['type OrInt<T> = T | Int', 'type A = OrInt<A>']],
    [
      'a type match giving it whole',
      ['type IdMatch<T> = match T:', '  case _: T', 'type A = IdMatch<A>'],
    ],
    [
      'a type match inspecting it',
      [
        'type Flip<T> = match T:',
        '  case Array<infer U>: Int',
        '  case _: Array<T>',
        'type A = Flip<A>',
      ],
    ],
    [
      'a type match giving what it infers from it whole',
      ['type Inner<T> = match T:', '  case Array<infer U>: U', 'type A = Inner<Array<A>>'],
    ],
  ])(
    'are unguarded through %s, so the alias reaching itself so is reported',
    (_case, declarations) => {
      expect(codesOf(...declarations)).toEqual(codesOf('type A = A | Int'));
      expect(codesOf(...declarations)).toContain(aliasCycle);
    },
  );

  it('are unguarded through an alias a module namespace qualifies', () => {
    const { codes } = reported(
      ["import * as lib from 'lib.ista'", 'type A = lib.OrInt<A>'].join('\n'),
      {
        'lib.ista': 'type OrInt<T> = T | Int',
      },
    );
    expect(codes).toEqual([aliasCycle]);
  });

  it.each([
    ['a nominal type', ['struct Box<T> { value: T }', 'type A = Int | Box<A>']],
    [
      'a transparent alias putting it in a field',
      ['type Cell<T> = { v: T }', 'type A = Int | Cell<A>'],
    ],
    [
      'a type match putting it in an array, inspecting nothing',
      ['type Wrap<T> = match T:', '  case _: Int | Array<T>', 'type A = Wrap<A>'],
    ],
  ])('are guarded through %s, so the alias is recursive', (_case, declarations) => {
    expect(codesOf(...declarations)).toEqual([]);
  });
});
