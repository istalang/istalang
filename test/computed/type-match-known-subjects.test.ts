/**
 * A type `match` given a known subject always reduces (§3.17): each case's pattern matches it or
 * fails, never leaving the use waiting, so a known use is never a type lowering would meet
 * unreduced. A union pattern's members holding variables (`List<infer T>?` inside a type, a
 * recursive alias's members `Tree<infer T>` unfolds to) each take a member of the subject's, and a
 * variable standing whole takes what is left; a generic subject's undecided case stays undecided,
 * never failed. A union subject distributes, so a union pattern meets it whole only inside a type.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computedTypesIn, errorIn } from '../../src/compiler/checker/types/parts/type-parts.ts';
import { codesOf, resolveWrittenTypes, runMain } from './computed.test-kit.ts';

const declarations = [
  'type List<T> = { head: T, tail: List<T>? }',
  'type IntList = { head: Int, tail: IntList? }',
  'type Tree<T> = T | Array<Tree<T>>',
  'struct Box<T> { value: T }',
];

/** `M<X>`: `pattern`'s case giving `result`, any other subject `Never`. */
function matchOf(pattern: string, result: string): readonly string[] {
  return ['type M<X> = match X:', `  case ${pattern}: ${result}`, '  case _: Never'];
}

describe('a type match given a known subject', () => {
  it.each([
    ['a recursive alias', 'List<infer T>', 'IntList'],
    ['an optional of a recursive alias, inside a type', 'Box<List<infer T>?>', 'Box<List<Int>?>'],
    ['an optional array, inside a type', 'Box<Array<infer T>?>', 'Box<Array<Int>?>'],
    ["a recursive alias's members", 'Tree<infer T>', 'Tree<Int>'],
  ])('matches %s, its variable bound', (_case, pattern, subject) => {
    const written = [...declarations, ...matchOf(pattern, 'T')];
    expect(codesOf(...written, `fn f(x: Int) -> M<${subject}>: x`)).toEqual([]);
    expect(runMain('Int', 'take(1)', [...written, `fn take(x: M<${subject}>) -> Int: x`])).toBe(1);
  });

  it('leaves a generic subject undecided, never falling through', () => {
    const written = [...declarations, ...matchOf('Tree<infer U>', 'U')];
    expect(codesOf(...written, 'fn f<T>(x: T) -> M<Tree<T>>: x')).toEqual([]);
  });

  it('always reduces, whatever the pattern', () => {
    const patterns = [
      'List<infer T>',
      'List<infer T>?',
      'Array<infer T>?',
      'Array<infer T>',
      'infer T | None',
      'Tree<infer T>',
      'Box<infer T>',
      '(infer T, infer U)',
      'Map<String, infer T>',
      'infer T | infer U',
    ];
    const subjects = [
      'Int',
      'None',
      'Int?',
      'Int | String',
      'Array<Int>',
      'Array<Int>?',
      'IntList',
      'List<String>?',
      'Tree<Int>',
      'Box<Tree<Int>>',
      '(Int, String)',
      'Map<String, Int>',
      'Array<IntList>',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...patterns),
        fc.constantFrom(...subjects),
        (pattern, subject) => {
          const { types } = resolveWrittenTypes(
            [`M<${subject}>`],
            [...declarations, ...matchOf(pattern, 'Int')],
          );
          const [reduced] = types;
          expect(reduced === undefined || errorIn(reduced) !== undefined).toBe(false);
          expect(computedTypesIn(reduced ?? { kind: 'error' }).map(({ kind }) => kind)).toEqual([]);
        },
      ),
      { numRuns: 130 },
    );
  });
});
