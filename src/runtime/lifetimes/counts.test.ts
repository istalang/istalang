/**
 * Counting holders over random holders of random values sharing parts by identity, as registers
 * and objects share them: a counted object's count is how many holders hold it directly, where a
 * composite reaching a counted object is one holder of each of its parts however many hold it, so
 * it has no holder exactly when no holder reaches it. Objects not counted are never counted, and a
 * cycle reaching no disposable never reaches zero, left to the commit.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CompositeValue,
  childValues,
  handleTo,
  isComposite,
  type Value,
} from '../../definition/values/values.ts';
import { testHeap } from '../scheduler/instance/heap.test-kit.ts';
import { type Held, nothingHeld } from '../snapshot/holdings.ts';
import { Counts } from './counts.ts';
import { countedIn, HolderWrites } from './holder-writes.ts';

/** The objects counted; handles to 4 and 5 name objects that aren't. */
const counted = [0, 1, 2, 3];

/** A value of the pool, built from the values made before it: a handle, a scalar or an array. */
type Recipe =
  | { readonly kind: 'handle'; readonly object: number }
  | { readonly kind: 'scalar' }
  | { readonly kind: 'array'; readonly parts: readonly number[] };

const recipeArbitrary: fc.Arbitrary<Recipe> = fc.oneof(
  fc.nat({ max: 5 }).map((object): Recipe => ({ kind: 'handle', object })),
  fc.constant<Recipe>({ kind: 'scalar' }),
  fc.array(fc.nat(), { maxLength: 3 }).map((parts): Recipe => ({ kind: 'array', parts })),
);

/** The values `recipes` make, an array's parts the very values made before it. */
function poolOf(recipes: readonly Recipe[]): readonly Value[] {
  const pool: Value[] = [];
  for (const recipe of recipes) {
    if (recipe.kind === 'handle') {
      pool.push(handleTo(recipe.object));
    } else if (recipe.kind === 'scalar') {
      pool.push(1n);
    } else {
      const made = [...pool];
      const elements =
        made.length === 0 ? [] : recipe.parts.map((part) => made[part % made.length]);
      pool.push({ kind: 'array', elements: elements.filter((part) => part !== undefined) });
    }
  }
  return pool;
}

/** One holder written: what it holds from now on, picked from the pool and the objects. */
interface Write {
  readonly holder: number;
  readonly values: readonly number[];
  readonly holds: readonly number[];
}

const writeArbitrary: fc.Arbitrary<Write> = fc.record({
  holder: fc.nat({ max: 2 }),
  values: fc.array(fc.nat(), { maxLength: 3 }),
  holds: fc.array(fc.nat({ max: 5 }), { maxLength: 2 }),
});

const reachesCounted = (value: Value): boolean =>
  isComposite(value) &&
  (value.kind === 'handle'
    ? counted.includes(value.object)
    : childValues(value).some(reachesCounted));

/** How many holders each counted object has: direct holds and handles, and live composites' parts. */
function expectedCounts(held: readonly Held[]): ReadonlyMap<number, number> {
  const counts = new Map(counted.map((object) => [object, 0]));
  const add = (object: number) => {
    const known = counts.get(object);
    if (known !== undefined) {
      counts.set(object, known + 1);
    }
  };
  const live = new Set<CompositeValue>();
  const pending: Value[] = [];
  for (const { values, holds } of held) {
    holds.forEach(add);
    pending.push(...values);
  }
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (isComposite(value) && value.kind === 'handle') {
      add(value.object);
    } else if (isComposite(value) && reachesCounted(value) && !live.has(value)) {
      live.add(value);
      pending.push(...childValues(value));
    }
  }
  return counts;
}

describe('counts', () => {
  it('count the holders of each counted object, a composite once however many hold it', () => {
    fc.assert(
      fc.property(
        fc.array(recipeArbitrary, { minLength: 1, maxLength: 12 }),
        fc.array(writeArbitrary, { maxLength: 12 }),
        (recipes, writes) => {
          const pool = poolOf(recipes);
          const counts = new Counts();
          for (const object of counted) {
            counts.made(object);
          }
          const holders: Held[] = [nothingHeld, nothingHeld, nothingHeld];
          for (const { holder, values, holds } of writes) {
            const now: Held = {
              values: values.flatMap((picked) => pool[picked % pool.length] ?? []),
              holds,
            };
            counts.changed(holders[holder] ?? nothingHeld, now);
            holders[holder] = now;
          }
          const expected = expectedCounts(holders);
          for (const object of [...counted, 4, 5]) {
            expect(counts.holdersOf(object)).toBe(expected.get(object));
          }
          expect(counts.takeZeroes()).toEqual(
            counted.filter((object) => expected.get(object) === 0),
          );
        },
      ),
    );
  });

  it('confirm a zero only if the object has no holder when they are taken', () => {
    const counts = new Counts();
    counts.made(0);
    const held: Held = { values: [{ kind: 'array', elements: [handleTo(0)] }], holds: [] };
    counts.changed(nothingHeld, held);
    counts.changed(held, nothingHeld);
    counts.changed(nothingHeld, held);
    expect(counts.takeZeroes()).toEqual([]);
    counts.changed(held, nothingHeld);
    expect(counts.takeZeroes()).toEqual([0]);
    expect(counts.takeZeroes()).toEqual([]);
  });
});

describe('counting a heap', () => {
  it('never takes a counted cycle reaching no disposable to zero, which a commit drops', () => {
    // `let f = fn: f()`: f's cell holds a closure capturing the cell (design.md §1).
    const holders = new HolderWrites(
      countedIn([
        {
          kind: 'extern',
          name: 'prelude._Cell',
          arguments: [],
          disposal: { kind: 'none' },
          counted: true,
        },
      ]),
    );
    const heap = testHeap([], holders);
    const cell = heap.add((id) => ({
      kind: 'cell',
      id,
      type: 0,
      value: { kind: 'closure', function: 0, captures: [handleTo(id)] },
    }));
    const register: Held = { values: [handleTo(cell.id)], holds: [] };
    holders.changed(nothingHeld, register);
    expect(holders.takeZeroes()).toEqual([]);
    holders.changed(register, nothingHeld);
    expect(holders.takeZeroes()).toEqual([]);
    expect(holders.holdersOf(cell.id)).toBe(1);
    heap.keepOnly(new Set());
    expect(heap.has(cell.id)).toBe(false);
    expect(holders.holdersOf(cell.id)).toBeUndefined();
  });
});
