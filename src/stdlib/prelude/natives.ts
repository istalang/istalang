/**
 * The prelude's natives: what the runtime runs for the prelude's extern functions, by the key
 * `externKey` gives their declarations (prelude.ista declares them; docs/arch/definition.md,
 * "Externs").
 *
 * - `Int` is a bigint, so integer arithmetic is exact at any size (§2); mixing an int with a float
 *   converts the int, and `/` always divides as floats.
 * - `//` floors and `%` takes the divisor's sign, so `a == (a // b) * b + a % b` holds (§3.9).
 * - `/` divides as IEEE 754 does, so dividing by zero gives an infinity or NaN (§2); `//` and `%`
 *   by zero have no int to give, which is a bug in the program, so they panic (§3.12). So does an
 *   int to a negative int power, and a negative shift count, as in Python.
 * - The bitwise operators are a bigint's, which act on an unbounded two's complement as Python's
 *   ints do.
 * - `compare` on floats subtracts, so infinities compare as expected; see `sign` for NaN.
 * - `Int(x)` truncates toward zero; a NaN or an infinity has no int, so it panics (§3.12).
 * - `_trace()` runs as `Error`'s `trace` default, in the entry a literal leaving the field out
 *   calls (§3.1), so it takes its caller's trace, without that entry's frame: an `Error`'s trace
 *   starts where it is built.
 */

import type { Value } from '../../definition/values/values.ts';
import { compareOrdered } from '../../language/order.ts';
import { conversionFunction } from '../../language/well-known/implicit-calls.ts';
import {
  type NativeContext,
  type Natives,
  Panic,
  type WithInstances,
  type WithSlots,
  type WithWeakSide,
} from '../../runtime/natives.ts';
import { divisionByZero, numeric } from '../numeric.ts';
import type { NativeKeys } from '../std-module.ts';
import { float, int, text } from '../values/arguments.ts';
import { arrayNatives } from './arrays.ts';
import { instanceNatives } from './instance-natives.ts';
import { mapNatives } from './maps.ts';
import { rangeNatives } from './range-natives.ts';
import { slotNatives } from './slot-natives.ts';
import { stringNatives } from './strings.ts';
import { textFormNatives } from './text-forms.ts';
import { weakNatives } from './weak-natives.ts';

export const preludeNatives = (
  keys: NativeKeys,
): Natives<NativeContext & WithSlots & WithWeakSide & WithInstances> => ({
  ...arrayNatives(keys),
  ...instanceNatives(keys),
  ...slotNatives(keys),
  ...mapNatives(keys),
  ...rangeNatives(keys),
  ...stringNatives(keys),
  ...weakNatives(keys),
  ...textFormNatives(keys),
  ...arithmeticNatives(keys),
  [keys.of('compare', 'String', 'String')]: ([left, right]) =>
    sign(compareOrdered(text(left), text(right))),
  [keys.of('add', 'String', 'String')]: ([left, right]) => text(left) + text(right),
  [keys.of('panic', 'String')]: ([message]) => {
    throw new Panic(text(message));
  },
  [keys.of('_trace')]: (_, context) => context.callerTrace(),
});

/** The operators and conversions over `Int` and `Float` (§2, §3.9, §3.10). */
const arithmeticNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  ...numeric(
    keys,
    'add',
    (left, right) => left + right,
    (left, right) => left + right,
  ),
  ...numeric(
    keys,
    'subtract',
    (left, right) => left - right,
    (left, right) => left - right,
  ),
  ...numeric(
    keys,
    'multiply',
    (left, right) => left * right,
    (left, right) => left * right,
  ),
  ...numeric(
    keys,
    'divide',
    (left, right) => Number(left) / Number(right),
    (left, right) => left / right,
  ),
  ...numeric(
    keys,
    'compare',
    (left, right) => sign(compareOrdered(left, right)),
    (left, right) => sign(left - right),
  ),
  [keys.of('floorDivide', 'Int', 'Int')]: ([left, right]) =>
    floorDivide(int(left), nonZero(int(right))),
  [keys.of('remainder', 'Int', 'Int')]: ([left, right]) => {
    const dividend = int(left);
    const by = nonZero(int(right));
    return dividend - floorDivide(dividend, by) * by;
  },
  ...numeric(keys, 'power', intPower, (base, exponent) => base ** exponent),
  ...bitwiseNatives(keys),
  [keys.of('negate', 'Int')]: ([value]) => -int(value),
  [keys.of('negate', 'Float')]: ([value]) => -float(value),
  [keys.ofStatic('Float', conversionFunction, 'Int')]: ([value]) => Number(int(value)),
  [keys.ofStatic('Int', conversionFunction, 'Float')]: ([value]) => truncated(float(value)),
});

// biome-ignore-start lint/suspicious/noBitwiseOperators: these are the language's bitwise operators.
/** `&`, `|`, `^`, `~` and the shifts on ints (§3.9). */
const bitwiseNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('bitAnd', 'Int', 'Int')]: ([left, right]) => int(left) & int(right),
  [keys.of('bitOr', 'Int', 'Int')]: ([left, right]) => int(left) | int(right),
  [keys.of('bitXor', 'Int', 'Int')]: ([left, right]) => int(left) ^ int(right),
  [keys.of('bitNot', 'Int')]: ([value]) => ~int(value),
  [keys.of('shiftLeft', 'Int', 'Int')]: ([value, count]) => int(value) << shiftCount(count),
  [keys.of('shiftRight', 'Int', 'Int')]: ([value, count]) => int(value) >> shiftCount(count),
});
// biome-ignore-end lint/suspicious/noBitwiseOperators: these are the language's bitwise operators.

function floorDivide(dividend: bigint, by: bigint): bigint {
  const quotient = dividend / by;
  const inexact = quotient * by !== dividend;
  return inexact && dividend < 0n !== by < 0n ? quotient - 1n : quotient;
}

/** `by`, when an int can be divided by it; dividing by zero panics (§3.12). */
function nonZero(by: bigint): bigint {
  if (by === 0n) {
    throw divisionByZero();
  }
  return by;
}

function intPower(base: bigint, exponent: bigint): bigint {
  if (exponent < 0n) {
    throw new Panic(`${base} to the power ${exponent} is no int; use a float base.`);
  }
  return base ** exponent;
}

/** A shift's count; a negative one panics, as Python's does, where a bigint's would shift back. */
function shiftCount(count: Value | undefined): bigint {
  const value = int(count);
  if (value < 0n) {
    throw new Panic(`A shift count can't be negative, as ${value} is.`);
  }
  return value;
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
