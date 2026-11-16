/**
 * The `math` module's natives (math.ista): rounding down and up to a whole float, and the square
 * root, JavaScript's `Math` on IEEE 754 doubles, so a zero keeps its sign and the square root of a
 * negative number is NaN. Every other rounding is the module's code over the two.
 */

import type { NativeContext, Natives } from '../../runtime/natives.ts';
import type { NativeKeys } from '../std-module.ts';
import { float } from '../values/arguments.ts';

export const mathNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('floor', 'Float')]: ([x]) => Math.floor(float(x)),
  [keys.of('ceil', 'Float')]: ([x]) => Math.ceil(float(x)),
  [keys.of('sqrt', 'Float')]: ([x]) => Math.sqrt(float(x)),
});
