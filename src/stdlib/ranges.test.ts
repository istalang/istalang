/**
 * A range's values: what it counts and what it reaches agree with stepping from its start, as
 * Python's `range` does, and a step longer than 1 needs a start.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Panic } from '../runtime/natives.ts';
import { countOf, reaches } from './ranges.ts';

const ints = fc.bigInt({ min: -40n, max: 40n });
const steps = fc.bigInt({ min: -5n, max: 5n }).filter((step) => step !== 0n);

/** The ints Python's `range(start, end, step)` gives. */
function stepped(start: bigint, end: bigint, step: bigint): bigint[] {
  const values: bigint[] = [];
  for (let value = start; step > 0n ? value < end : value > end; value += step) {
    values.push(value);
  }
  return values;
}

describe('a range', () => {
  it("counts the ints Python's range gives", () => {
    fc.assert(
      fc.property(ints, ints, steps, (start, end, step) => {
        expect(countOf({ start, end, step })).toBe(BigInt(stepped(start, end, step).length));
      }),
    );
  });

  it('reaches exactly those ints', () => {
    fc.assert(
      fc.property(ints, ints, steps, ints, (start, end, step, value) => {
        const expected = stepped(start, end, step).includes(value);
        expect(reaches({ start, end, step }, value)).toBe(expected);
      }),
    );
  });

  it('with an open end, reaches every step from its start onward', () => {
    fc.assert(
      fc.property(ints, steps, ints, (start, step, value) => {
        const onward = step > 0n ? value >= start : value <= start;
        const expected = onward && (value - start) % step === 0n;
        expect(reaches({ start, end: undefined, step }, value)).toBe(expected);
      }),
    );
  });

  it('with an open start, reaches what lies before its end, stepping only by 1', () => {
    expect(reaches({ start: undefined, end: 5n, step: 1n }, -100n)).toBe(true);
    expect(reaches({ start: undefined, end: 5n, step: 1n }, 5n)).toBe(false);
    expect(reaches({ start: undefined, end: 5n, step: -1n }, 6n)).toBe(true);
    expect(() => reaches({ start: undefined, end: 5n, step: 2n }, 1n)).toThrow(Panic);
  });
});
