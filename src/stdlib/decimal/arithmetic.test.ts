/**
 * Decimal arithmetic (arithmetic.ts) against generated numbers: canonical text reads back to
 * itself, dividing to places rounds once as an independent long division does, floored division
 * keeps `a == (a // b) * b + a % b`, and powers raised through bigints agree with decimal.js's.
 */

import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Rounding } from '../math/rounding.ts';
import {
  canonicalText,
  decimalOf,
  decimalRoundings,
  dividedTo,
  floorDivided,
  power,
  readDecimal,
  remainderOf,
} from './arithmetic.ts';

const modes = Object.keys(decimalRoundings) as Rounding[];

/** Text in the language's grammar: a sign, digits with leading zeros, and maybe a fraction. */
const decimalText = fc
  .tuple(
    fc.boolean(),
    fc.stringMatching(/^\d{1,40}$/u),
    fc.option(fc.stringMatching(/^\d{1,40}$/u), { nil: undefined }),
  )
  .map(([negative, whole, fraction]) => {
    const unsigned = fraction === undefined ? whole : `${whole}.${fraction}`;
    return negative ? `-${unsigned}` : unsigned;
  });

/**
 * A number of any magnitude: up to 40 significant digits shifted up to 60 places either way, so
 * its text crosses the sizes where decimal.js would switch to an exponent and has long runs of
 * zeros on either side of its digits.
 */
const anyDecimal = fc
  .tuple(fc.boolean(), fc.stringMatching(/^[1-9]\d{0,39}$/u), fc.integer({ min: -60, max: 60 }))
  .map(([negative, digits, shift]) =>
    decimalOf(negative ? `-${digits}` : digits).times(`1e${shift}`),
  );

/** Canonical text: no `-0`, no leading zeros, and no zeros ending a fraction. */
const canonicalForm = /^(?:0|-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?)$/u;

/** A small decimal, as a whole number shifted by a few places. */
const smallDecimal = fc
  .tuple(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 0, max: 3 }))
  .map(([units, places]) => decimalOf(BigInt(units)).times(`1e-${places}`));

/**
 * `left / right` rounded to `places` through a long division 60 digits deep, truncated: for numbers
 * this small no rounding boundary lies between the truncated and the exact quotient.
 */
function longDivision(left: Decimal, right: Decimal, places: number, mode: Rounding): Decimal {
  const deep = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_DOWN });
  return new deep(left).div(right).toDecimalPlaces(places, decimalRoundings[mode]);
}

describe('canonical text', () => {
  it('reads back to itself, in canonical form', () => {
    fc.assert(
      fc.property(decimalText, (source) => {
        const read = readDecimal(source);
        expect(read?.eq(new Decimal(source))).toBe(true);
        const written = canonicalText(read ?? decimalOf(0n));
        expect(written).toMatch(canonicalForm);
        expect(canonicalText(readDecimal(written) ?? decimalOf(0n))).toBe(written);
      }),
    );
  });

  it("writes any magnitude as decimal.js's plain notation does, and reads it back", () => {
    fc.assert(
      fc.property(anyDecimal, (value) => {
        const written = canonicalText(value);
        expect(written).toBe(value.toFixed(value.decimalPlaces()));
        expect(written).toMatch(canonicalForm);
        expect(readDecimal(written)?.eq(value)).toBe(true);
        expect(canonicalText(readDecimal(written) ?? decimalOf(0n))).toBe(written);
      }),
    );
  });

  it('writes digits spanning many words, and zeros past them, in plain notation', () => {
    const between = `1.${'0'.repeat(50_000)}1`;
    expect(canonicalText(decimalOf(between))).toBe(between);
    expect(canonicalText(decimalOf(1n).times('1e-1000'))).toBe(`0.${'0'.repeat(999)}1`);
    expect(canonicalText(decimalOf(-25n).times('1e1000'))).toBe(`-25${'0'.repeat(1000)}`);
  });

  it('refuses what the grammar does not write', () => {
    for (const source of ['1e5', 'Infinity', '-Infinity', 'NaN', '0x1f', '0b1', '.5', '5.', '+5']) {
      expect(readDecimal(source)).toBeUndefined();
    }
  });
});

describe('dividedTo', () => {
  it('rounds the exact quotient once, in every mode', () => {
    fc.assert(
      fc.property(
        smallDecimal,
        smallDecimal.filter((divisor) => !divisor.isZero()),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom(...modes),
        (left, right, places, mode) => {
          const divided = dividedTo(left, right, BigInt(places), decimalRoundings[mode]);
          expect(divided.toString()).toBe(longDivision(left, right, places, mode).toString());
        },
      ),
    );
  });
});

describe('floorDivided and remainderOf', () => {
  it('keep a == (a // b) * b + a % b, the remainder taking the divisor sign', () => {
    fc.assert(
      fc.property(
        decimalText,
        decimalText.filter((text) => !new Decimal(text).isZero()),
        (leftText, rightText) => {
          const left = decimalOf(leftText);
          const right = decimalOf(rightText);
          const quotient = floorDivided(left, right);
          const remainder = remainderOf(left, right);
          expect(quotient.isInteger()).toBe(true);
          expect(quotient.times(right).plus(remainder).eq(left)).toBe(true);
          expect(remainder.isZero() || remainder.isNeg() === right.isNeg()).toBe(true);
          expect(remainder.abs().lt(right.abs())).toBe(true);
        },
      ),
    );
  });
});

describe('power', () => {
  const exactly = Decimal.clone({ precision: 1e9 });

  it('agrees with decimal.js for small exponents, exactly at or above 0', () => {
    fc.assert(
      fc.property(smallDecimal, fc.integer({ min: 0, max: 12 }), (base, exponent) => {
        expect(power(base, BigInt(exponent)).eq(new exactly(base).pow(exponent))).toBe(true);
      }),
    );
  });

  it('divides as `/` does for a negative exponent', () => {
    const quotient = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_EVEN });
    fc.assert(
      fc.property(
        smallDecimal.filter((base) => !base.isZero()),
        fc.integer({ min: 1, max: 6 }),
        (base, exponent) => {
          const expected = new quotient(1).div(new exactly(base).pow(exponent));
          expect(power(base, BigInt(-exponent)).eq(expected)).toBe(true);
        },
      ),
    );
  });
});
