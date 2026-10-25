/**
 * Positions in sequences: `at` agrees with JavaScript's, indexing and slicing panic exactly
 * outside the bounds and otherwise select what JavaScript's `slice` would, and a range iterates
 * its ints only with both ends.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Value } from '../../definition/values.ts';
import { Panic } from '../../runtime/natives.ts';
import { atPosition, checkedIndex, rangeInts, spanOf } from './positions.ts';

/** A prelude `Range` value: its ends are `Optional` variants, `Some` holding a field. */
function rangeOf(start: bigint | undefined, end: bigint | undefined): Value {
  const optional = (value: bigint | undefined): Value => ({
    kind: 'variant',
    type: 0,
    variant: value === undefined ? 1 : 0,
    fields: value === undefined ? [] : [value],
  });
  return { kind: 'struct', type: 1, fields: [optional(start), optional(end)] };
}

/** What `run` gives, or that it panicked. */
function outcomeOf<Result>(run: () => Result): Result | 'panic' {
  try {
    return run();
  } catch (error) {
    if (error instanceof Panic) {
      return 'panic';
    }
    throw error;
  }
}

const sizes = fc.nat({ max: 20 });
const positions = fc.bigInt({ min: -30n, max: 30n });
const ends = fc.option(positions, { nil: undefined });

describe('positions in sequences', () => {
  it('read `at` as JavaScript does, a negative index counting from the end', () => {
    fc.assert(
      fc.property(sizes, positions, (size, key) => {
        const items = Array.from({ length: size }, (_, index) => index);
        const at = atPosition(key, size);
        expect(at === undefined ? undefined : items[at]).toBe(items.at(Number(key)));
      }),
    );
  });

  it('index only inside the bounds, panicking outside', () => {
    fc.assert(
      fc.property(sizes, positions, (size, key) => {
        const inside = key >= 0n && key < BigInt(size);
        expect(outcomeOf(() => checkedIndex(key, size, 'an array'))).toEqual(
          inside ? Number(key) : 'panic',
        );
      }),
    );
  });

  it('slice only inside the bounds, open ends meaning the whole length', () => {
    fc.assert(
      fc.property(sizes, ends, ends, (size, start, last) => {
        const from = start ?? 0n;
        const to = last ?? BigInt(size);
        const inside = from >= 0n && from <= to && to <= BigInt(size);
        expect(outcomeOf(() => spanOf(rangeOf(start, last), size, 'an array'))).toEqual(
          inside ? [Number(from), Number(to)] : 'panic',
        );
      }),
    );
  });

  it('iterate a range with both ends, and nothing when it is empty', () => {
    fc.assert(
      fc.property(ends, ends, (start, last) => {
        const expected =
          start === undefined || last === undefined
            ? 'panic'
            : Array.from(
                { length: Math.max(0, Number(last - start)) },
                (_, offset) => start + BigInt(offset),
              );
        expect(outcomeOf(() => rangeInts(rangeOf(start, last)))).toEqual(expected);
      }),
    );
  });
});
