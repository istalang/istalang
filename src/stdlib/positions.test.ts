/**
 * Positions in sequences: `at` agrees with JavaScript's, indexing and slicing panic exactly outside
 * the bounds and otherwise select what JavaScript's `slice` would, and a stepped range selects
 * what Python's extended slice would.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../../test/timeouts.ts';
import { Panic } from '../runtime/natives.ts';
import { atPosition, checkedIndex, selected, selectionOf, splicesOf } from './positions.ts';
import type { RangeValue } from './ranges.ts';

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
const steps = fc.bigInt({ min: -4n, max: 4n }).filter((step) => step !== 0n);

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

  it('index only inside the bounds, panicking outside', { timeout: slowTestTimeout }, () => {
    fc.assert(
      fc.property(sizes, positions, (size, key) => {
        const inside = key >= 0n && key < BigInt(size);
        expect(outcomeOf(() => checkedIndex(key, size, 'an array'))).toEqual(
          inside ? Number(key) : 'panic',
        );
      }),
    );
  });

  it('slice only inside the bounds, open ends meaning the whole length', {
    timeout: slowTestTimeout,
  }, () => {
    fc.assert(
      fc.property(sizes, ends, ends, (size, start, end) => {
        const from = start ?? 0n;
        const to = end ?? BigInt(size);
        const inside = from >= 0n && from <= to && to <= BigInt(size);
        expect(outcomeOf(() => selectionOf({ start, end, step: 1n }, size, 'an array'))).toEqual(
          inside ? { kind: 'span', start: Number(from), end: Number(to) } : 'panic',
        );
      }),
    );
  });

  it("select with a step what Python's extended slice selects, inside the bounds", {
    timeout: slowTestTimeout,
  }, () => {
    fc.assert(
      fc.property(sizes, ends, ends, steps, (size, start, end, step) => {
        const items = Array.from({ length: size }, (_, index) => index);
        const range = { start, end, step };
        expect(outcomeOf(() => selected(items, selectionOf(range, size, 'an array')))).toEqual(
          isInside(range, size) ? pythonSlice(items, range) : 'panic',
        );
      }),
    );
  });

  it('replace a span by any number of items, and a stepped slice by as many as it selects', {
    timeout: slowTestTimeout,
  }, () => {
    fc.assert(
      fc.property(sizes, steps, fc.nat({ max: 10 }), (size, step, count) => {
        const items = Array.from({ length: size }, (_, index) => index);
        const range = { start: undefined, end: undefined, step };
        const replacement = Array.from({ length: count }, (_, index) => -index - 1);
        const selection = selectionOf(range, size, 'an array');
        expect(outcomeOf(() => spliced(items, selection, replacement))).toEqual(
          replacedAsPython(items, range, replacement),
        );
      }),
    );
  });
});

/** `items` with the splices replacing `selection` by `replacement` made, as `setIndex` makes them. */
function spliced(
  items: readonly number[],
  selection: ReturnType<typeof selectionOf>,
  replacement: readonly number[],
): number[] {
  const changed = [...items];
  for (const { start, count, items: inserted } of splicesOf(selection, replacement)) {
    changed.splice(start, count, ...inserted);
  }
  return changed;
}

/** Whether `range`'s ends, defaulted by its step's direction, lie inside a sequence of `size`. */
function isInside(range: RangeValue, size: number): boolean {
  const { from, to, forward } = pythonEnds(range, size);
  return forward
    ? from >= 0n && from <= to && to <= BigInt(size)
    : to >= -1n && to <= from && from < BigInt(size);
}

/** A range's ends as Python's slices default them: by the step's direction. */
function pythonEnds({ start, end, step }: RangeValue, size: number) {
  const forward = step > 0n;
  return {
    forward,
    from: start ?? (forward ? 0n : BigInt(size) - 1n),
    to: end ?? (forward ? BigInt(size) : -1n),
  };
}

/** Python's `items[a:b:step] = replacement` over the whole of `items`, or that it would raise. */
function replacedAsPython(
  items: readonly number[],
  range: RangeValue,
  replacement: readonly number[],
): number[] | 'panic' {
  if (range.step === 1n) {
    return [...replacement];
  }
  const selectedPositions = pythonSlice(items, range);
  if (selectedPositions.length !== replacement.length) {
    return 'panic';
  }
  const changed = [...items];
  for (const [index, position] of selectedPositions.entries()) {
    changed[position] = replacement[index] ?? Number.NaN;
  }
  return changed;
}

/**
 * Python's `items[start:end:step]` for ends already inside, an end of -1 meaning before the first.
 */
function pythonSlice(items: readonly number[], range: RangeValue): number[] {
  const { from, to, forward } = pythonEnds(range, items.length);
  const result: number[] = [];
  for (let position = from; forward ? position < to : position > to; position += range.step) {
    result.push(items[Number(position)] ?? Number.NaN);
  }
  return result;
}
