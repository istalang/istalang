/**
 * The `math` module's natives (math.ista): `abs`, `round` in every mode (rounding.ts), and `sqrt`,
 * which is JavaScript's `Math.sqrt` on IEEE 754 doubles, so the square root of a negative number is
 * NaN; an int converts to the nearest float.
 */

import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { float, int, variantEntry } from '../native-values.ts';
import { asFloat } from '../numeric.ts';
import type { NativeKeys } from '../std-module.ts';
import { floatRoundings, roundingType } from './rounding.ts';

export const mathNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('abs', 'Int')]: ([x]) => {
    const value = int(x);
    return value < 0n ? -value : value;
  },
  [keys.of('abs', 'Float')]: ([x]) => Math.abs(float(x)),
  [keys.of('round', 'Float', roundingType(keys))]: ([x, mode], context) =>
    variantEntry(context, mode, floatRoundings)(float(x)),
  [keys.of('sqrt', 'Int')]: ([x]) => Math.sqrt(asFloat(x)),
  [keys.of('sqrt', 'Float')]: ([x]) => Math.sqrt(float(x)),
});
