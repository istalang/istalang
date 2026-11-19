/**
 * A recursive alias whose body is another alias of its group, written as one or reached through a
 * type `match`, is that alias (§4.6): it closes to the same recursive type, never to one with the
 * error type where its own use stands, and it checks and runs as that type.
 */

import { describe, expect, it } from 'vitest';
import { codesOf, compareWrittenTypes, runMain } from '../written-types.test-kit.ts';
import { sameComputedType } from './computed.test-kit.ts';

const tree = 'type Tree = Int | Array<Tree>';

describe('a recursive alias forwarding to another of its group', () => {
  it.each([
    ['written as that alias', ['type A = B', 'type B = Int | Array<A>']],
    [
      'reached through a type match',
      ['type Id<T> = match T:', '  case _: T', 'type A = Id<B>', 'type B = Int | Array<A>'],
    ],
    [
      'reached through a type match given itself',
      ['type Wrap<T> = match T:', '  case _: Int | Array<T>', 'type A = Wrap<A>'],
    ],
  ])('is that alias, %s', async (_case, declarations) => {
    const written = [tree, ...declarations];
    expect(compareWrittenTypes('A', 'Tree', written)).toEqual(sameComputedType);
    expect(codesOf(...written, 'fn f(x: A) -> Int: 0')).toEqual([]);
    expect(
      await runMain('Int', 'take([1, [2, [3]]])', [...written, 'fn take(a: A) -> Int: 7']),
    ).toBe(7);
  });
});
