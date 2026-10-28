/**
 * Code point positions: a position's UTF-16 offset is the length of the code points before it, and
 * converting that offset back gives the position again, in whatever order offsets are asked for.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  codePointAtPosition,
  codePointCount,
  codePointPositions,
  codePointSlice,
  codePoints,
  codePointsAt,
  utf16Offset,
} from './code-points.ts';

const anyText = fc.string({ unit: 'binary', maxLength: 40 });

describe('code points', () => {
  it("gives a position's offset as the UTF-16 length of the code points before it", () => {
    fc.assert(
      fc.property(anyText, fc.integer({ min: -3, max: 50 }), (s, position) => {
        const before = codePoints(s).slice(0, Math.max(position, 0)).join('');
        expect(utf16Offset(s, position)).toBe(before.length);
      }),
    );
  });

  it('converts offsets back to positions, asked in any order', () => {
    fc.assert(
      fc.property(
        anyText.chain((s) =>
          fc.tuple(
            fc.constant(s),
            fc.array(fc.integer({ min: 0, max: codePoints(s).length }), { maxLength: 10 }),
          ),
        ),
        ([s, positions]) => {
          const positionOf = codePointPositions(s);
          for (const position of positions) {
            expect(positionOf(utf16Offset(s, position))).toBe(position);
          }
        },
      ),
    );
  });

  it('counts, indexes and slices code points without building their array', () => {
    fc.assert(
      fc.property(
        anyText,
        fc.integer({ min: -3, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (s, position, end) => {
          const points = codePoints(s);
          expect(codePointCount(s)).toBe(points.length);
          expect(codePointAtPosition(s, position)).toBe(
            position < 0 ? '' : (points[position] ?? ''),
          );
          const read = codePointsAt(s);
          expect(points.map((_, index) => read(index))).toEqual(points);
          expect(points.map((_, index) => read(points.length - 1 - index)).toReversed()).toEqual(
            points,
          );
          const from = Math.max(position, 0);
          expect(codePointSlice(s, from, end)).toBe(points.slice(from, end).join(''));
        },
      ),
    );
  });
});
