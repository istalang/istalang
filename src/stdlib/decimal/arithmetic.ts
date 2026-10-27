/**
 * Decimal arithmetic over decimal.js (§3.8), on numbers in their canonical text: the one form a
 * Decimal has, with no exponent, no zeros ending its fraction and no `-0`.
 *
 * - decimal.js writes its text a few characters at a time, which exhausts the heap long before a
 *   string reaches its limit, so no path asks decimal.js for text: it is written here from the
 *   number's digits, base-1e7 words joined a block at a time, and its exponent, the zeros it adds
 *   made with `repeat`. That is linear, and refused at once past the longest string, a limit that
 *   panics as every limit does (runtime/scheduler/segment/limits.ts).
 * - `exact` computes at decimal.js's largest precision, `maximumDigits`, so `+`, `-` and `*` are
 *   exact: no text the runtime holds has that many digits. A count of places or digits past it
 *   could only be rounded, so it panics. `/` and a negative power round half to even to 34
 *   significant digits, decimal128's precision.
 * - decimal.js rounds a quotient to significant digits, not to places, so `dividedTo` rounds once
 *   from the integer quotient and its remainder, through a stand-in fraction that every mode rounds
 *   as it would the exact one.
 * - decimal.js checks no size before raising to a power, and a large exponent would run for hours,
 *   so `power` raises the digits as a bigint, whose `**` refuses an oversized result at once.
 * - decimal.js reads more than the language does (exponents, `Infinity`, hex), so `readDecimal`
 *   checks the text against the language's grammar first, which also bounds a value's size by its
 *   text's.
 * - `%` takes the divisor's sign (decimal.js's floored modulo), and `//` is what makes
 *   `a == (a // b) * b + a % b` hold, as on ints (§3.9).
 */

import { Decimal as DecimalJs } from 'decimal.js';
import { Panic } from '../../runtime/natives.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Rounding } from '../math/rounding.ts';
import { divisionByZero } from '../numeric.ts';

/** A decimal.js number. */
export type Decimal = DecimalJs;

/** A rounding mode, as decimal.js numbers them. */
export type DecimalRounding = DecimalJs.Rounding;

// biome-ignore-start lint/style/useNamingConvention: the keys are the enum's variant names.
/** Each `Rounding` mode (math.ista) as decimal.js numbers it. */
export const decimalRoundings = {
  Floor: DecimalJs.ROUND_FLOOR,
  Ceiling: DecimalJs.ROUND_CEIL,
  TowardZero: DecimalJs.ROUND_DOWN,
  AwayFromZero: DecimalJs.ROUND_UP,
  HalfEven: DecimalJs.ROUND_HALF_EVEN,
  HalfAwayFromZero: DecimalJs.ROUND_HALF_UP,
} as const satisfies Record<Rounding, DecimalRounding>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the enum's variant names.

/** decimal.js's largest precision, its `MAX_DIGITS`. */
const maximumDigits = 1e9;

const exact = DecimalJs.clone({
  precision: maximumDigits,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  modulo: DecimalJs.ROUND_FLOOR,
});

const quotient = exact.clone({ precision: 34 });

/** The digits in each of decimal.js's base-1e7 words after the first. */
const digitsPerWord = 7;

/** How many words are joined into one string at a time. */
const wordsPerBlock = 4096;

/** The zeros ending a word, which ends the digits when it is the last. */
const trailingZeros = /0+$/u;

/** What `Decimal.parse` reads: an optional `-`, digits, and an optional fraction. */
const grammar = /^-?\d+(?:\.\d+)?$/u;

/**
 * A fraction below, at or above a half, by how twice a remainder compares with its divisor: every
 * mode rounds it as it rounds the remainder's own fraction.
 */
const standIns = new Map([
  [-1, '0.25'],
  [0, '0.5'],
  [1, '0.75'],
]);

/** The number canonical `text` or an int writes. */
export function decimalOf(value: string | bigint): Decimal {
  return new exact(value);
}

/** The number `source` writes in the language's grammar, or undefined for any other text. */
export function readDecimal(source: string): Decimal | undefined {
  return grammar.test(source) ? decimalOf(source) : undefined;
}

/** `value`'s canonical text, written from its digits and exponent. */
export function canonicalText(value: Decimal): string {
  if (value.isZero()) {
    return '0';
  }
  const digits = significantDigits(value);
  const pointAfter = value.e + 1;
  const sign = value.isNeg() ? '-' : '';
  if (pointAfter <= 0) {
    return `${sign}0.${'0'.repeat(-pointAfter)}${digits}`;
  }
  if (pointAfter >= digits.length) {
    return `${sign}${digits}${'0'.repeat(pointAfter - digits.length)}`;
  }
  return `${sign}${digits.slice(0, pointAfter)}.${digits.slice(pointAfter)}`;
}

/** `value` with exactly `places` digits after the point, rounded in `mode`. */
export function fixedText(value: Decimal, places: bigint, mode: DecimalRounding): string {
  const [whole = unreachable('A number has digits.'), fraction = ''] = canonicalText(
    roundedTo(value, places, mode),
  ).split('.');
  return places === 0n ? whole : `${whole}.${fraction.padEnd(Number(places), '0')}`;
}

/** The integer part of `value`, as an int. */
export function truncatedInt(value: Decimal): bigint {
  return BigInt(canonicalText(value.trunc()));
}

/** The float nearest `value`. */
export function nearestFloat(value: Decimal): number {
  return Number(canonicalText(value));
}

/** `value` rounded to `places` digits after the point in `mode`. */
export function roundedTo(value: Decimal, places: bigint, mode: DecimalRounding): Decimal {
  return value.toDecimalPlaces(placesOf(places), mode);
}

/** `left / right`, rounded half to even to 34 significant digits. */
export function divided(left: Decimal, right: Decimal): Decimal {
  return new quotient(left).div(nonZero(right));
}

/** The exact quotient of `left` and `right`, rounded to `places` digits after the point. */
export function dividedTo(
  left: Decimal,
  right: Decimal,
  places: bigint,
  mode: DecimalRounding,
): Decimal {
  const shift = placesOf(places);
  const scaled = left.times(`1e${shift}`);
  const whole = scaled.divToInt(nonZero(right));
  const remainder = scaled.minus(whole.times(right));
  if (remainder.isZero()) {
    return whole.times(`1e-${shift}`);
  }
  const fraction =
    standIns.get(remainder.abs().times(2).cmp(right.abs())) ?? unreachable('cmp gives a sign.');
  const negative = left.isNeg() !== right.isNeg();
  return whole
    .plus(negative ? `-${fraction}` : fraction)
    .toDecimalPlaces(0, mode)
    .times(`1e-${shift}`);
}

/** `left // right`: the floor of the quotient. */
export function floorDivided(left: Decimal, right: Decimal): Decimal {
  return left.minus(remainderOf(left, right)).div(right);
}

/** `left % right`, with the divisor's sign. */
export function remainderOf(left: Decimal, right: Decimal): Decimal {
  return left.mod(nonZero(right));
}

/** `base` to the power `exponent`, through its digits as a bigint. */
export function power(base: Decimal, exponent: bigint): Decimal {
  const [whole = unreachable('A number has digits.'), fraction = ''] =
    canonicalText(base).split('.');
  const magnitude = exponent < 0n ? -exponent : exponent;
  const placesAfterPoint = BigInt(fraction.length) * magnitude;
  if (placesAfterPoint > maximumDigits) {
    throw new Panic(
      `${canonicalText(base)} to the power ${exponent} has more digits than a Decimal can hold.`,
    );
  }
  const raised = new exact(`${BigInt(whole + fraction) ** magnitude}e-${placesAfterPoint}`);
  return exponent < 0n ? divided(decimalOf(1n), raised) : raised;
}

/**
 * The significant digits of `value`, which isn't zero, from decimal.js's words: base 1e7, so every
 * word after the first is seven digits, and the last may end in zeros. Each block of words is
 * joined on its own, so every string built is flat, never a long chain of small appends.
 */
function significantDigits(value: Decimal): string {
  const words = value.d;
  const last = words.length - 1;
  const wordText = (word: number, index: number): string => {
    const text = index === 0 ? String(word) : String(word).padStart(digitsPerWord, '0');
    return index === last ? text.replace(trailingZeros, '') : text;
  };
  const blocks: string[] = [];
  for (let start = 0; start < words.length; start += wordsPerBlock) {
    const block = words.slice(start, start + wordsPerBlock);
    blocks.push(block.map((word, offset) => wordText(word, start + offset)).join(''));
  }
  return blocks.join('');
}

/** `divisor`, when it can divide; a Decimal has no infinity, so dividing by zero panics. */
function nonZero(divisor: Decimal): Decimal {
  if (divisor.isZero()) {
    throw divisionByZero();
  }
  return divisor;
}

/**
 * A count of places after the point; a negative one is a bug in the program, and one past
 * `maximumDigits` a count no Decimal can have.
 */
function placesOf(places: bigint): number {
  if (places < 0n || places > maximumDigits) {
    throw new Panic(`A Decimal can't have ${places} places after the point.`);
  }
  return Number(places);
}
