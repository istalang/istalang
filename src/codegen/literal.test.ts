/**
 * A constant's literal evaluates to the value it spells, exactly: every number JSON can't hold
 * (NaN, the infinities, -0) and every integer beyond a double's precision included.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { valueArbitrary } from '../definition/values/values.test-kit.ts';
import { literal } from './literal.ts';

/** What JavaScript evaluates `source`, an expression, to. */
function evaluated(source: string): unknown {
  return new Function(`return ${source};`)();
}

describe('literal', () => {
  it('evaluates to the value it spells', () => {
    fc.assert(
      fc.property(valueArbitrary(), (value) => {
        expect(evaluated(literal(value))).toStrictEqual(value);
      }),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 2 ** 60])(
    'spells the float %d exactly',
    (float) => {
      expect(Object.is(evaluated(literal(float)), float)).toBe(true);
    },
  );

  it('spells an integer beyond a double exactly', () => {
    expect(evaluated(literal(2n ** 100n + 1n))).toBe(2n ** 100n + 1n);
  });
});
