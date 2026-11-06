/**
 * Numbers as std natives take them (§2, §3.9): the int/float overloads of an operation, and
 * division by zero, for the prelude and `math` alike.
 *
 * - Mixed operands are overloads, never a promotion rule: an operation on two ints stays an int,
 *   and any float makes it a float, the int converted.
 * - Dividing by zero where the result has no infinity, as `//` on ints, is a bug in the program,
 *   so it panics (§3.12).
 */

import type { Value } from '../definition/values/values.ts';
import { type Native, type NativeContext, type Natives, Panic } from '../runtime/natives.ts';
import { float, int } from './native-values.ts';
import type { NativeKeys } from './std-module.ts';

const numericPairs = [
  ['Int', 'Int'],
  ['Float', 'Float'],
  ['Int', 'Float'],
  ['Float', 'Int'],
] as const;

/**
 * The four numeric overloads of `name`: two ints go to `onInts`, any pair with a float to
 * `onFloats`, the int converted.
 */
export function numeric(
  keys: NativeKeys,
  name: string,
  onInts: (left: bigint, right: bigint) => Value,
  onFloats: (left: number, right: number) => Value,
): Natives<NativeContext> {
  return Object.fromEntries(
    numericPairs.map(([left, right]): [string, Native<NativeContext>] => [
      keys.of(name, left, right),
      left === 'Int' && right === 'Int'
        ? ([a, b]) => onInts(int(a), int(b))
        : ([a, b]) => onFloats(asFloat(a), asFloat(b)),
    ]),
  );
}

/** An int or a float argument, as a float. */
export function asFloat(value: Value | undefined): number {
  return typeof value === 'bigint' ? Number(value) : float(value);
}

/** The panic of dividing by zero where the result has no infinity. */
export function divisionByZero(): Panic {
  return new Panic('Division by zero.');
}
