/**
 * The `math` module's natives (math.ista): `abs`, `round` in every mode (rounding.ts), `pow` and
 * `sqrt`.
 *
 * - `pow` and `sqrt` with a float are JavaScript's `**` and `Math.sqrt`, IEEE 754 doubles, so the
 *   square root of a negative number is NaN; an int operand converts to the nearest float.
 * - An int to an int power is exact at any size, and a negative exponent has no int, which is a bug
 *   in the program, so it panics (§3.12).
 */

import { type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import { float, int, variantEntry } from '../native-values.ts';
import { asFloat, numeric } from '../numeric.ts';
import type { NativeKeys } from '../std-module.ts';
import { floatRoundings, roundingType } from './rounding.ts';

export const mathNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('abs', 'int')]: ([x]) => {
    const value = int(x);
    return value < 0n ? -value : value;
  },
  [keys.of('abs', 'float')]: ([x]) => Math.abs(float(x)),
  [keys.of('round', 'float', roundingType(keys))]: ([x, mode], context) =>
    variantEntry(context, mode, floatRoundings)(float(x)),
  ...numeric(keys, 'pow', intPower, (base, exponent) => base ** exponent),
  [keys.of('sqrt', 'int')]: ([x]) => Math.sqrt(asFloat(x)),
  [keys.of('sqrt', 'float')]: ([x]) => Math.sqrt(float(x)),
});

function intPower(base: bigint, exponent: bigint): bigint {
  if (exponent < 0n) {
    throw new Panic(`${base} to the power ${exponent} is no int; use a float base.`);
  }
  return base ** exponent;
}
