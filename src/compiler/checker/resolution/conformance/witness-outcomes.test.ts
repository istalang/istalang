/**
 * A witness search judges each goal once (§3.5, §3.10): wrappers meeting a trait through the same
 * constraint on what they wrap ask the same goals again at each level, which a search answers from
 * what it already found, so checking a nested model costs linearly in its depth. What it keeps
 * answers as the goal would: a struct-constraint goal meets what the greatest fixed point of its
 * goals meets (coinductive), whatever was asked first.
 */

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { checkProgram } from '../../check.ts';
import { typeText } from '../../types/type-text.ts';
import { formNodeLibrary } from './conformance.test-kit.ts';
import { SearchGoals } from './witness-outcomes.ts';

/** A model `depth` levels deep: each level wraps the one below in a `Group`, beside a field. */
function nestedModel(depth: number): string {
  const levels = Array.from(
    { length: depth },
    (_, level) => `struct M${level + 1} { inner: Group<M${level}>, label: Field<String> }`,
  );
  return [
    formNodeLibrary,
    'struct M0 { leaf: Field<Int> }',
    ...levels,
    `fn check(g: Group<M${depth}>): ()`,
  ].join('\n');
}

/** How often checking a model `depth` deep reads the fields of its innermost level. */
function innermostReads(depth: number): number {
  const checker = checkProgram(stdProgramOf({ 'main.ista': nestedModel(depth) }));
  const fieldsOf = vi.spyOn(checker, 'fieldsOf');
  const codes = checker.diagnosticsOf(idOf('main.ista')).map(({ code }) => code);
  if (codes.length > 0) {
    throw new Error(`A model ${depth} deep reported ${codes.join(', ')}`);
  }
  return fieldsOf.mock.calls.filter(([type]) => typeText(type) === 'M0').length;
}

/** A goal of a struct-constraint system: unmet itself, or met when every goal it asks is. */
interface Goal {
  readonly unmet: boolean;
  readonly asks: readonly number[];
}

const goalSystems = fc.integer({ min: 1, max: 6 }).chain((size) =>
  fc.array(
    fc.record({
      unmet: fc.nat(4).map((roll) => roll === 0),
      asks: fc.array(fc.nat(size - 1), { maxLength: 3 }),
    }),
    { minLength: size, maxLength: size },
  ),
);

/** Which goals the greatest fixed point meets: all, but for those unmet or asking one unmet. */
function greatestFixedPoint(goals: readonly Goal[]): readonly boolean[] {
  const met = goals.map(() => true);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [index, goal] of goals.entries()) {
      if (met[index] && (goal.unmet || goal.asks.some((asked) => !met[asked]))) {
        met[index] = false;
        changed = true;
      }
    }
  }
  return met;
}

/** Asks `goals` in `order` of one search, each by what it lacks, as struct-constraint goals are. */
function searched(goals: readonly Goal[], order: readonly number[]): readonly boolean[] {
  const search = new SearchGoals();
  const lacks = (index: number): string | undefined =>
    search.shortfall(`${index}`, () => {
      const goal = goals[index];
      if (goal === undefined || goal.unmet) {
        return 'unmet';
      }
      return goal.asks.some((asked) => lacks(asked) !== undefined) ? 'asks one unmet' : undefined;
    });
  const met = goals.map(() => false);
  for (const index of order) {
    met[index] = lacks(index) === undefined;
  }
  return met;
}

describe('a witness search', () => {
  it('judges each goal once, so each level of a nested model adds the same work', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), (depth) => {
        const shallow = innermostReads(depth);
        const middle = innermostReads(depth + 1);
        expect(innermostReads(depth + 2) - middle).toBe(middle - shallow);
      }),
      { numRuns: 3 },
    );
  });

  it('answers each coinductive goal as the greatest fixed point does, whatever is asked first', () => {
    fc.assert(
      fc.property(
        goalSystems.chain((goals) =>
          fc.tuple(
            fc.constant(goals),
            fc.shuffledSubarray([...goals.keys()], { minLength: goals.length }),
          ),
        ),
        ([goals, order]) => {
          const expected = greatestFixedPoint(goals);
          const met = searched(goals, order);
          expect(order.map((index) => met[index])).toEqual(order.map((index) => expected[index]));
        },
      ),
      {
        // 1 met only by taking 0 as met, which then fails through 2.
        examples: [
          [
            [
              [
                { unmet: false, asks: [1, 2] },
                { unmet: false, asks: [0] },
                { unmet: true, asks: [] },
              ],
              [0, 1],
            ],
          ],
        ],
      },
    );
  });

  it('finds a failure again for a site that reports it, and reuses what was met', () => {
    const search = new SearchGoals();
    const find = vi.fn(() => 'failed' as const);
    search.witnesses('failing', find);
    search.witnesses('failing', find);
    search.witnessesReported('failing', find);
    expect(find).toHaveBeenCalledTimes(2);
    const met = vi.fn(() => []);
    search.witnesses('met', met);
    search.witnessesReported('met', met);
    expect(met).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing a goal found while the search reached the depth bound', () => {
    const search = new SearchGoals();
    const step = vi.fn(() => {
      search.reachedBound();
      return 'endless';
    });
    search.shortfall('deep', step);
    search.shortfall('deep', step);
    expect(step).toHaveBeenCalledTimes(2);
  });
});
