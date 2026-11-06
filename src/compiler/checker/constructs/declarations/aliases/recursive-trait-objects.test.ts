/**
 * Recursive aliases through a trait object's arguments (§3.10, §3.17): `any Trait<…>` is a type
 * built from others, so a use of the alias inside its arguments is guarded, closes like any guarded
 * use, and two aliases alike up to the written order of their constraints are one type.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../../../stdlib/prelude/prelude.test-kit.ts';
import { lines } from '../../../../parser/parse.test-kit.ts';
import { reported } from '../../../check.test-kit.ts';

const holds = lines('trait Holds<S>:', '  fn held(self: &Self) -> S');

describe('a recursive alias through a trait object', () => {
  it('closes an alias naming itself in a trait object argument', () => {
    expect(reported(lines(holds, 'type A = { f: any Holds<A>, n: Int }'))).toEqual(reportedNothing);
  });

  it('builds and walks a tree whose children are any iterable of trees', () => {
    const declarations = lines(
      'type Tree = { n: Int, kids: any Iterable<Tree> }',
      'fn total(t: Tree) -> Int:',
      '  let sum = t.n',
      '  for kid in t.kids:',
      '    sum += total(kid)',
      '  sum',
      'fn grown() -> Tree:',
      '  const empty: Array<Tree> = []',
      '  const leaf: Tree = struct{n: 3, kids: empty}',
      '  return struct{n: 1, kids: [leaf, struct{n: 2, kids: empty}]}',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(mainGives('Int', 'return total(grown())', declarations)).toBe(6);
  });

  it('makes two aliases alike up to their constraints written order one type', () => {
    const declarations = lines(
      holds,
      'trait Named:',
      '  fn name(self: &Self) -> String',
      'type P = { f: any Holds<P> & Named, n: Int }',
      'type Q = { f: any Named & Holds<Q>, n: Int }',
      'fn pass(p: P) -> Q: p',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
  });
});
