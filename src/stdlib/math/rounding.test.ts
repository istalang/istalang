/**
 * Rounding a float in each mode (rounding.ts) agrees with decimal.js rounding the float's decimal
 * text, for every double: a float whose shortest text ends in `.5` is exactly that tie, so the two
 * meet at every tie. A zero keeps its sign, which decimal.js's text doesn't carry.
 */

import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decimalRoundings } from '../decimal/arithmetic.ts';
import { floatRoundings, type Rounding } from './rounding.ts';

const modes = Object.keys(floatRoundings) as Rounding[];

/** `x` with a zero's sign dropped, which decimal.js's text doesn't carry. */
function signless(x: number): number {
  return x + 0;
}

/** `x` rounded in `mode` by decimal.js, from its shortest decimal text. */
function roundedText(x: number, mode: Rounding): number {
  return new Decimal(String(x)).toDecimalPlaces(0, decimalRoundings[mode]).toNumber();
}

describe('floatRoundings', () => {
  it.each(modes)('%s rounds every finite double as decimal.js rounds its text', (mode) => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        expect(signless(floatRoundings[mode](x))).toBe(signless(roundedText(x, mode)));
      }),
    );
  });

  it.each(modes)('%s rounds halves exactly', (mode) => {
    fc.assert(
      fc.property(fc.integer({ min: -(2 ** 40), max: 2 ** 40 }), (whole) => {
        const tie = whole + 0.5;
        expect(signless(floatRoundings[mode](tie))).toBe(signless(roundedText(tie, mode)));
      }),
    );
  });

  it.each(modes)('%s keeps NaN, the infinities and the sign of a zero', (mode) => {
    const round = floatRoundings[mode];
    expect(round(Number.NaN)).toBeNaN();
    expect(round(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(round(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
    expect(Object.is(round(-0), -0)).toBe(true);
    expect(Object.is(round(0), 0)).toBe(true);
  });

  it('rounds a negative fraction that rounds to zero to -0', () => {
    expect(Object.is(floatRoundings.HalfEven(-0.4), -0)).toBe(true);
    expect(Object.is(floatRoundings.HalfEven(-0.5), -0)).toBe(true);
    expect(Object.is(floatRoundings.TowardZero(-0.9), -0)).toBe(true);
  });
});
