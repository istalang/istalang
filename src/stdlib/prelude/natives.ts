/**
 * The prelude's natives: what the runtime runs for the prelude's extern functions, by the key
 * `externKey` gives their declarations (prelude.ista declares them; docs/arch/definition.md,
 * "Externs").
 *
 * - `int` is a bigint, so integer arithmetic is exact at any size (§2); mixing an int with a float
 *   converts the int, and `/` always divides as floats.
 * - `//` floors and `%` takes the divisor's sign, so `a == (a // b) * b + a % b` holds (§3.9).
 * - Dividing by zero is a bug in the program, so it panics (§3.12), for floats too.
 * - `compare` on floats subtracts, so infinities compare as expected; see `sign` for NaN.
 * - Adding a primitive to a string appends its text; a whole float keeps its `.0`, so `1.0` never
 *   reads as the int `1`. `string(x)` spells a primitive the same way.
 * - `int(x)` truncates toward zero; a NaN or an infinity has no int, so it panics (§3.12).
 */

import { nativeKey, primitiveKey } from '../../definition/extern-key.ts';
import type { Value } from '../../definition/values.ts';
import type { PrimitiveName } from '../../language/primitives.ts';
import { type Native, type Natives, Panic } from '../../runtime/natives.ts';
import { float, int, text } from '../native-values.ts';
import { preludeName } from '../stdlib-loader.ts';
import { arrayNatives } from './arrays.ts';
import { mapNatives } from './maps.ts';
import { stringNatives } from './strings.ts';

/** A float printed as whole digits, which needs `.0` to read as a float. */
const wholeDigits = /^-?\d+$/u;

const numericPairs = [
  ['int', 'int'],
  ['float', 'float'],
  ['int', 'float'],
  ['float', 'int'],
] as const;

const floatDivide = (left: number, right: number): number => left / nonZero(right);

export const preludeNatives: Natives = {
  ...arrayNatives,
  ...mapNatives,
  ...stringNatives,
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
  ...numeric('divide', (left, right) => floatDivide(Number(left), Number(right)), floatDivide),
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
  ...Object.fromEntries(
    (['string', 'int', 'float', 'bool'] as const).map((right) => [
      preludeKey('add', 'string', right),
      ([left, value]: readonly Value[]) => text(left) + appendedText(value),
    ]),
  ),
  [preludeKey('float.from', 'int')]: ([value]) => Number(int(value)),
  [preludeKey('int.from', 'float')]: ([value]) => truncated(float(value)),
  ...Object.fromEntries(
    (['int', 'float', 'bool'] as const).map((from) => [
      preludeKey('string.from', from),
      ([value]: readonly Value[]) => appendedText(value),
    ]),
  ),
  [preludeKey('panic', 'string')]: ([message]) => {
    throw new Panic(text(message));
  },
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

/** The key prelude.ista's declaration of `name` over primitive `parameters` gets. */
export function preludeKey(name: string, ...parameters: readonly PrimitiveName[]): string {
  return nativeKey(preludeName, name, ...parameters.map(primitiveKey));
}

function floorDivide(dividend: bigint, by: bigint): bigint {
  const quotient = dividend / by;
  const inexact = quotient * by !== dividend;
  return inexact && dividend < 0n !== by < 0n ? quotient - 1n : quotient;
}

/** `by`, when something can be divided by it; dividing by zero panics (§3.12). */
function nonZero<Divisor extends bigint | number>(by: Divisor): Divisor {
  if (Number(by) === 0) {
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

function appendedText(value: Value | undefined): string {
  if (typeof value === 'number') {
    const digits = String(value);
    return wholeDigits.test(digits) ? `${digits}.0` : digits;
  }
  return String(value);
}

function asFloat(value: Value | undefined): number {
  return typeof value === 'bigint' ? Number(value) : float(value);
}
