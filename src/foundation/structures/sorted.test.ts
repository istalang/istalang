import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lastIndexAtMost } from './sorted.ts';

describe('lastIndexAtMost', () => {
  it('finds what scanning from the end finds', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50, max: 50 })),
        fc.integer({ min: -60, max: 60 }),
        (keys, value) => {
          const sorted = keys.toSorted((first, second) => first - second);
          const scanned = sorted.findLastIndex((key) => key <= value);
          expect(lastIndexAtMost(sorted, (key) => key, value)).toBe(scanned);
        },
      ),
    );
  });
});
