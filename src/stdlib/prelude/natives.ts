/**
 * The prelude's natives: what the runtime runs for the prelude's extern functions, by the key
 * `externKey` gives their declarations (prelude.ista declares them; docs/arch/definition.md,
 * "Externs").
 *
 * - `int` is a bigint, so integer arithmetic is exact at any size (§2); mixing an int with a float
 *   converts the int, and `/` always divides as floats.
 * - `//` floors and `%` takes the divisor's sign, so `a == (a // b) * b + a % b` holds (§3.9).
 * - `/` divides as IEEE 754 does, so dividing by zero gives an infinity or NaN (§2); `//` and `%`
 *   by zero have no int to give, which is a bug in the program, so they panic (§3.12).
 * - `compare` on floats subtracts, so infinities compare as expected; see `sign` for NaN.
 * - `int(x)` truncates toward zero; a NaN or an infinity has no int, so it panics (§3.12).
 * - `_trace()` runs as `Error`'s `trace` default, in the entry a literal leaving the field out
 *   calls (§3.1), so it leaves that entry's frame out: an `Error`'s trace starts where it is built.
 */

import { preludeKey } from '../../definition/extern-key.ts';
import type { Value } from '../../definition/values.ts';
import { type Native, type Natives, Panic } from '../../runtime/natives.ts';
import { float, int, text } from '../native-values.ts';
import { arrayNatives } from './arrays.ts';
import { mapNatives } from './maps.ts';
import { slotNatives } from './slot-natives.ts';
import { stringNatives } from './strings.ts';
import { textFormNatives } from './text-forms.ts';
import { weakNatives } from './weak-natives.ts';

const numericPairs = [
  ['int', 'int'],
  ['float', 'float'],
  ['int', 'float'],
  ['float', 'int'],
] as const;

export const preludeNatives: Natives = {
  ...arrayNatives,
  ...slotNatives,
  ...mapNatives,
  ...stringNatives,
  ...weakNatives,
  ...textFormNatives,
  ...numeric(
    'add',
    (left, right) => left + right,
    (left, right) => left + right,
  ),
  ...numeric(
    'subtract',
    (left, right) => left - right,
    (left, right) => left - right,
  ),
  ...numeric(
    'multiply',
    (left, right) => left * right,
    (left, right) => left * right,
  ),
  ...numeric(
    'divide',
    (left, right) => Number(left) / Number(right),
    (left, right) => left / right,
  ),
  ...numeric(
    'compare',
    (left, right) => sign(compareOrdered(left, right)),
    (left, right) => sign(left - right),
  ),
  [preludeKey('floorDivide', 'int', 'int')]: ([left, right]) =>
    floorDivide(int(left), nonZero(int(right))),
  [preludeKey('remainder', 'int', 'int')]: ([left, right]) => {
    const dividend = int(left);
    const by = nonZero(int(right));
    return dividend - floorDivide(dividend, by) * by;
  },
  [preludeKey('negate', 'int')]: ([value]) => -int(value),
  [preludeKey('negate', 'float')]: ([value]) => -float(value),
  [preludeKey('compare', 'string', 'string')]: ([left, right]) =>
    sign(compareOrdered(text(left), text(right))),
  [preludeKey('add', 'string', 'string')]: ([left, right]) => text(left) + text(right),
  [preludeKey('float.from', 'int')]: ([value]) => Number(int(value)),
  [preludeKey('int.from', 'float')]: ([value]) => truncated(float(value)),
  [preludeKey('panic', 'string')]: ([message]) => {
    throw new Panic(text(message));
  },
  [preludeKey('_trace')]: (_, context) => context.trace().split('\n').slice(1).join('\n'),
};

/**
 * The four numeric overloads of operator `name`: two ints go to `onInts`, any pair with a float
 * to `onFloats`, the int converted.
 */
function numeric(
  name: string,
  onInts: (left: bigint, right: bigint) => Value,
  onFloats: (left: number, right: number) => Value,
): Natives {
  return Object.fromEntries(
    numericPairs.map(([left, right]): [string, Native] => [
      preludeKey(name, left, right),
      left === 'int' && right === 'int'
        ? ([a, b]) => onInts(int(a), int(b))
        : ([a, b]) => onFloats(asFloat(a), asFloat(b)),
    ]),
  );
}

function floorDivide(dividend: bigint, by: bigint): bigint {
  const quotient = dividend / by;
  const inexact = quotient * by !== dividend;
  return inexact && dividend < 0n !== by < 0n ? quotient - 1n : quotient;
}

/** `by`, when an int can be divided by it; dividing by zero panics (§3.12). */
function nonZero(by: bigint): bigint {
  if (by === 0n) {
    throw new Panic('Division by zero.');
  }
  return by;
}

function compareOrdered<Ordered extends bigint | string>(left: Ordered, right: Ordered): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * A comparison's result as the int `compare` returns (§3.9). One int can't say "unordered", so a
 * NaN compares as equal; `==` alone follows IEEE 754 and finds NaN equal to nothing.
 */
function sign(comparison: number): bigint {
  return Number.isNaN(comparison) ? 0n : BigInt(Math.sign(comparison));
}

function truncated(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Panic(`${value} has no int.`);
  }
  return BigInt(Math.trunc(value));
}

function asFloat(value: Value | undefined): number {
  return typeof value === 'bigint' ? Number(value) : float(value);
}
