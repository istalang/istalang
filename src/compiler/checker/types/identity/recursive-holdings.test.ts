/**
 * A recursive union in a union (§2, §3.17, proposal 5 §2): its members join the union, so through a
 * chain of recursive aliases, each naming the one before in its union, every alias is one type, a
 * value of the innermost member goes into the outermost union wherever a value goes (a constant, a
 * return, an argument, a literal's item, a generic function's body), and type patterns select it at
 * every level. Each case runs, since a value put through the wrong variants checks but reads back
 * wrong.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../../stdlib/prelude/prelude.test-kit.ts';
import { lines } from '../../../parser/parse.test-kit.ts';
import { reported } from '../../check.test-kit.ts';

/**
 * `depth` aliases, `A1 = Int | Array<A1>` and each next `Ak = A(k-1) | Array<Ak>`, all one type,
 * with `level`, which takes a value of `A{depth}` apart one alias at a time: one for each level a
 * pattern selected, plus the Int found innermost. The alias before covers every value, so a case
 * after it would be unreachable.
 */
function chainOf(depth: number): string {
  const aliases = Array.from({ length: depth }, (_, index) => {
    const level = index + 1;
    return level === 1
      ? 'type A1 = Int | Array<A1>'
      : `type A${level} = A${level - 1} | Array<A${level}>`;
  });
  const levels = Array.from({ length: depth }, (_, index) => {
    const level = index + 1;
    const inner =
      level === 1
        ? '    case Int as n: return n'
        : `    case A${level - 1} as b: return 1 + level${level - 1}(b)`;
    return level === 1
      ? lines(
          `fn level${level}(a: A${level}) -> Int:`,
          '  match a:',
          inner,
          '    case _: return -100',
        )
      : lines(`fn level${level}(a: A${level}) -> Int:`, '  match a:', inner);
  });
  return lines(...aliases, ...levels);
}

/** `x: A{depth} | String` taken apart by the patterns of every level, and the Int innermost. */
function readersOf(depth: number): string {
  return lines(
    `fn read(x: A${depth} | String) -> Int:`,
    '  match x:',
    `    case A${depth} as a: return level${depth}(a)`,
    '    case String: return -1',
    `fn innermost(x: A${depth} | String) -> Int:`,
    '  match x:',
    '    case Int as n: return n',
    '    case _: return -1',
  );
}

describe('a member of a recursive union flattened into a recursive union', () => {
  const forest = lines('type Tree = Int | Array<Tree>', 'type Forest = Tree | Array<Forest>');

  it('goes into the outer union in a constant, a return, an argument and a literal item', async () => {
    const declarations = lines(
      forest,
      'const e: Forest | String = 7',
      'fn returned() -> Forest | String: 7',
      'fn passed(x: Forest | String) -> Forest | String: x',
      'fn read(x: Forest | String) -> Int:',
      '  match x:',
      '    case Int as n: return n',
      '    case _: return 0',
      'fn items() -> Int:',
      '  const xs: Array<Forest | String> = [7, "a"]',
      '  return read(xs[0])',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(
      await mainGives(
        'Int',
        'return read(e) + read(returned()) + read(passed(7)) + items()',
        declarations,
      ),
    ).toBe(28);
  });

  it('merges into the union it joins, written or made by an instantiation', async () => {
    const declarations = lines(
      forest,
      'fn wrap<U>(x: U) -> U | Forest | String: x',
      'fn same(x: Forest | Int) -> Forest: x',
      'fn isForest() -> Bool: wrap(42) is Forest',
    );
    expect(reported(declarations)).toEqual(reportedNothing);
    expect(await mainGives('Bool', 'return isForest()', declarations)).toBe(true);
  });

  it('is selected by type patterns at every level, through a chain of any length, one type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.constantFrom('constant', 'return', 'argument'),
        async (depth, position) => {
          const outer = `A${depth} | String`;
          const value = {
            constant: lines(`const v: ${outer} = 7`, `fn given() -> ${outer}: v`),
            return: `fn given() -> ${outer}: 7`,
            argument: lines(
              `fn pass(x: ${outer}) -> ${outer}: x`,
              `fn given() -> ${outer}: pass(7)`,
            ),
          }[position];
          const declarations = lines(chainOf(depth), readersOf(depth), value);
          expect(reported(declarations)).toEqual(reportedNothing);
          expect(await mainGives('Int', 'return read(given())', declarations)).toBe(depth - 1 + 7);
          expect(await mainGives('Int', 'return innermost(given())', declarations)).toBe(7);
        },
      ),
      { numRuns: 12 },
    );
  });
});
