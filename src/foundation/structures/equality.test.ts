import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distinctItems } from './equality.ts';

describe('distinctItems', () => {
  const sameParity = (first: number, second: number) => first % 2 === second % 2;

  it('keeps the first of each item equal to others, in order', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 9 })), (items) => {
        expect(distinctItems(items, Object.is)).toEqual([...new Set(items)]);
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

  it('keeps the same items when keyed by a key equal items share', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 99 })),
        fc.integer({ min: 1, max: 5 }),
        (items, buckets) => {
          const sameTens = (first: number, second: number) =>
            Math.floor(first / 10) === Math.floor(second / 10);
          const key = (item: number) => String(Math.floor(item / 10) % buckets);
          expect(distinctItems(items, sameTens, key)).toEqual(distinctItems(items, sameTens));
        },
      ),
    );
  });
});
