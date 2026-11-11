import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distinctItems } from './equality.ts';

describe('distinctItems', () => {
  const sameParity = (first: number, second: number) => first % 2 === second % 2;

  it('keeps the first of each item equal to others, in order', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 9 })), (items) => {
        expect(distinctItems(items)).toEqual([...new Set(items)]);
      }),
    );
  });

  it('compares by the equality given', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 9 })), (items) => {
        const firsts = [0, 1].flatMap((parity) => items.find((item) => item % 2 === parity) ?? []);
        expect(distinctItems(items, sameParity)).toEqual(
          firsts.toSorted((first, second) => items.indexOf(first) - items.indexOf(second)),
        );
      }),
    );
  });
});
