/**
 * Numbers as std natives take them (§2, §3.9): an operation's overloads on two ints and on two
 * floats, and division by zero. Mixed operands are the prelude's code, converting the int.
 *
 * Dividing by zero where the result has no infinity, as `//` on ints, is a bug in the program, so
 * it panics (§3.12).
 */

import type { Value } from '../definition/values/values.ts';
import { type NativeContext, type Natives, Panic } from '../runtime/natives.ts';
import type { NativeKeys } from './std-module.ts';
import { float, int } from './values/arguments.ts';

/** The two overloads of `name`: two ints go to `onInts`, two floats to `onFloats`. */
export function numeric(
  keys: NativeKeys,
  name: string,
  onInts: (left: bigint, right: bigint) => Value,
  onFloats: (left: number, right: number) => Value,
): Natives<NativeContext> {
  return {
    [keys.of(name, 'Int', 'Int')]: ([a, b]) => onInts(int(a), int(b)),
    [keys.of(name, 'Float', 'Float')]: ([a, b]) => onFloats(float(a), float(b)),
  };
}

/** The panic of dividing by zero where the result has no infinity. */
export function divisionByZero(): Panic {
  return new Panic('Division by zero.');
}
