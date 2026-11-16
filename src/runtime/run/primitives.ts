/**
 * The primitive operations compiled code can't write as one JavaScript operator
 * (codegen/primitives.ts): those that panic, and those whose rule differs from the operator's.
 * Every backend implements the same rules (definition/instructions/primitive-ops.ts).
 */

import { Panic } from '../natives.ts';

function nonZero(by: bigint): bigint {
  if (by === 0n) {
    throw new Panic('Division by zero.');
  }
  return by;
}

/** `dividend` divided by `by`, rounded toward negative infinity; by zero panics (§3.12). */
export function floorDivide(dividend: bigint, by: bigint): bigint {
  const quotient = dividend / nonZero(by);
  const inexact = quotient * by !== dividend;
  return inexact && dividend < 0n !== by < 0n ? quotient - 1n : quotient;
}

/** What floor division of `dividend` by `by` leaves, of the divisor's sign. */
export function remainder(dividend: bigint, by: bigint): bigint {
  return dividend - floorDivide(dividend, by) * by;
}

export function intPower(base: bigint, exponent: bigint): bigint {
  if (exponent < 0n) {
    throw new Panic(`${base} to the power ${exponent} is no int; use a float base.`);
  }
  return base ** exponent;
}

/** A shift's count; a negative one panics, as Python's does, where a bigint's would shift back. */
function shiftCount(count: bigint): bigint {
  if (count < 0n) {
    throw new Panic(`A shift count can't be negative, as ${count} is.`);
  }
  return count;
}

export function shiftLeft(value: bigint, count: bigint): bigint {
  return value << shiftCount(count);
}

export function shiftRight(value: bigint, count: bigint): bigint {
  return value >> shiftCount(count);
}

/**
 * A comparison's result as the int `compare` returns (§3.9). One int can't say "unordered", so a
 * NaN compares as equal; `==` alone follows IEEE 754 and finds NaN equal to nothing.
 */
export function floatCompare(left: number, right: number): bigint {
  const difference = left - right;
  return Number.isNaN(difference) ? 0n : BigInt(Math.sign(difference));
}

/** A float's int, truncated toward zero; a float that is no number has none, a bug. */
export function intFromFloat(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Panic(`${value} has no int.`);
  }
  return BigInt(Math.trunc(value));
}
