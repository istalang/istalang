/**
 * The decimal module (decimal.ista) against decimal.js on generated numbers: each operation the
 * module writes on ints gives what decimal.js gives, its text in the one form a Decimal has. Many
 * cases run in one program, which writes every result as text.
 */

import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decimalJsRoundings, type Rounding, roundings } from '../math/rounding-oracle.test-kit.ts';
import { mainGives } from '../prelude/prelude.test-kit.ts';

/** Exact arithmetic, whose text never takes an exponent. */
const exact = Decimal.clone({
  precision: 1e9,
  rounding: Decimal.ROUND_HALF_EVEN,
  modulo: Decimal.ROUND_FLOOR,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

const quotient = exact.clone({ precision: 34 });

/** Text in the language's grammar: a sign, digits with leading zeros, and maybe a fraction. */
const decimalText = fc
  .tuple(
    fc.boolean(),
    fc.stringMatching(/^\d{1,20}$/u),
    fc.option(fc.stringMatching(/^\d{1,20}$/u), { nil: undefined }),
  )
  .map(([negative, whole, fraction]) => {
    const unsigned = fraction === undefined ? whole : `${whole}.${fraction}`;
    return negative ? `-${unsigned}` : unsigned;
  });

/** Two numbers, places to round to, a mode and an exponent: one case of every operation. */
interface Case {
  readonly left: string;
  readonly right: string;
  readonly places: number;
  readonly mode: Rounding;
  readonly exponent: number;
}

const cases = fc.array(
  fc.record({
    left: decimalText,
    right: decimalText,
    places: fc.integer({ min: 0, max: 8 }),
    mode: fc.constantFrom(...roundings),
    exponent: fc.integer({ min: -4, max: 6 }),
  }),
  { minLength: 20, maxLength: 20 },
);

/** A small number, whose exact quotients run no long way past a rounding boundary. */
const smallText = fc
  .tuple(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 0, max: 3 }))
  .map(([units, places]) => written(new exact(units).times(`1e-${places}`)));

const smallDivisions = fc.array(
  fc.record({
    left: smallText,
    right: smallText.filter((text) => !new exact(text).isZero()),
    places: fc.integer({ min: 0, max: 4 }),
    mode: fc.constantFrom(...roundings),
  }),
  { minLength: 20, maxLength: 20 },
);

/** A number's text in its one form: plain notation, with no `-0`. */
function written(value: Decimal): string {
  return value.isZero() ? '0' : value.toString();
}

/** `value` with exactly `places` digits after the point, with no `-0`. */
function fixed(value: Decimal, places: number): string {
  const text = value.toFixed(places);
  return value.isZero() ? text.replace('-', '') : text;
}

/** Each expression of a case, giving a String, beside the text decimal.js gives for it. */
function expressions({ left, right, places, mode, exponent }: Case): [string, string][] {
  const a = new exact(left);
  const b = new exact(right);
  const [x, y] = [`d("${left}")`, `d("${right}")`];
  const rounded = a.toDecimalPlaces(places, decimalJsRoundings[mode]);
  const each: [string, string][] = [
    [`String(${x})`, written(a)],
    [`String(${x} + ${y})`, written(a.plus(b))],
    [`String(${x} - ${y})`, written(a.minus(b))],
    [`String(${x} * ${y})`, written(a.times(b))],
    [`String(decimal.compare(${x}, ${y}))`, String(a.cmp(b))],
    [`String(${x}.round(${places}, Rounding.${mode}))`, written(rounded)],
    [`${x}.toFixed(${places}, Rounding.${mode})`, fixed(rounded, places)],
  ];
  if (!b.isZero()) {
    each.push(
      [`String(${x} / ${y})`, written(new quotient(a).div(b))],
      [`String(${x} // ${y})`, written(a.minus(a.mod(b)).div(b))],
      [`String(${x} % ${y})`, written(a.mod(b))],
    );
  }
  const raised = exponent >= 0 ? a.pow(exponent) : undefined;
  if (raised !== undefined) {
    each.push([`String(${x} ** ${exponent})`, written(raised)]);
  } else if (!a.isZero()) {
    each.push([`String(${x} ** ${exponent})`, written(new quotient(1).div(a.pow(-exponent)))]);
  }
  return each;
}

/** What the program giving the array of `lines`, each an expression giving a String, gives. */
async function istalang(lines: readonly string[]): Promise<unknown> {
  const declarations = `import Decimal from 'decimal'
import * as decimal from 'decimal'
import Rounding from 'math'
fn d(text: String) -> Decimal:
  match Decimal.parse(text):
    case Ok(value): value
    case Err(error): panic(error.message)`;
  return await mainGives('Array<String>', `[\n${lines.join('\n')}\n]`, declarations);
}

describe('decimal arithmetic', () => {
  it('agrees with decimal.js on every operation', async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (generated) => {
        const each = generated.flatMap(expressions);
        const results = await istalang(each.map(([line]) => line));
        expect(results).toEqual(each.map(([, expected]) => expected));
      }),
      { numRuns: 4 },
    );
  });

  it('divides to places as a deep long division rounded once does', async () => {
    const deep = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_DOWN });
    await fc.assert(
      fc.asyncProperty(smallDivisions, async (generated) => {
        const lines = generated.map(
          ({ left, right, places, mode }) =>
            `String(decimal.divide(d("${left}"), d("${right}"), ${places}, Rounding.${mode}))`,
        );
        const expected = generated.map(({ left, right, places, mode }) =>
          written(
            new exact(new deep(left).div(right).toDecimalPlaces(places, decimalJsRoundings[mode])),
          ),
        );
        expect(await istalang(lines)).toEqual(expected);
      }),
      { numRuns: 4 },
    );
  });
});
