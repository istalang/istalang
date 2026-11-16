/**
 * Rounding a float in each mode (math.ista) against decimal.js rounding the float's decimal text,
 * for generated doubles: a float whose shortest text ends in `.5` is exactly that tie, so the two
 * meet at every tie. A zero keeps its sign, which decimal.js's text doesn't carry, so the sign is
 * checked on its own, as `1.0 / r` shows it: a rounding keeps the sign of what it rounds.
 */

import { Decimal } from 'decimal.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mainGives } from '../prelude/prelude.test-kit.ts';
import { decimalJsRoundings, type Rounding, roundings } from './rounding-oracle.test-kit.ts';

const declarations = `import * as math from 'math'
import Rounding from 'math'
fn f(text: String) -> Float:
  match Float.parse(text):
    case Ok(value): value
    case Err(error): panic(error.message)
fn shown(r: Float) -> String: String(r) + (if 1.0 / r < 0.0: " negative" else: "")`;

/** A float's text when it is whole, which `toString` writes with a `.0` after it. */
const wholeDigits = /^-?\d+$/u;

/** A float and a mode; halves and short decimals are generated often. */
const roundingCase = fc.record({
  x: fc.oneof(
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.integer({ min: -(2 ** 40), max: 2 ** 40 }).map((whole) => whole + 0.5),
    fc.integer({ min: -100, max: 100 }).map((tenths) => tenths / 10),
  ),
  mode: fc.constantFrom(...roundings),
});

/**
 * What `shown` writes for `x` rounded in `mode`, by decimal.js and the sign of `x`: a whole float's
 * text keeps its `.0`, unless JavaScript writes it with an exponent.
 */
function expectedText(x: number, mode: Rounding): string {
  const r = new Decimal(String(x)).toDecimalPlaces(0, decimalJsRoundings[mode]).toNumber();
  const negative = r < 0 || (r === 0 && (x < 0 || Object.is(x, -0)));
  const digits = String(r);
  const text = wholeDigits.test(digits) ? `${digits}.0` : digits;
  return negative ? `${text} negative` : text;
}

/** `x` as text `Float.parse` reads back exactly, a `-0` keeping its sign, which `String` drops. */
function floatText(x: number): string {
  return Object.is(x, -0) ? '-0' : String(x);
}

/** What the program gives for `lines`, each an expression giving a String. */
async function shownTexts(lines: readonly string[]): Promise<unknown> {
  return await mainGives('Array<String>', `[\n${lines.join('\n')}\n]`, declarations);
}

describe('math.round', () => {
  it('rounds every finite double as decimal.js rounds its text, keeping its sign', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(roundingCase, { minLength: 40, maxLength: 40 }), async (cases) => {
        const lines = cases.map(
          ({ x, mode }) => `shown(math.round(f("${floatText(x)}"), Rounding.${mode}))`,
        );
        expect(await shownTexts(lines)).toEqual(cases.map(({ x, mode }) => expectedText(x, mode)));
      }),
      { numRuns: 4 },
    );
  });

  it('keeps NaN and the infinities, and a zero its sign, in every mode', async () => {
    const special = ['0.0 / 0.0', '1.0 / 0.0', '-1.0 / 0.0', '0.0', '-0.0'];
    const lines = roundings.flatMap((mode) =>
      special.map((x) => `shown(math.round(${x}, Rounding.${mode}))`),
    );
    const each = ['NaN', 'Infinity', '-Infinity', '0.0', '0.0 negative'];
    expect(await shownTexts(lines)).toEqual(roundings.flatMap(() => each));
  });
});
