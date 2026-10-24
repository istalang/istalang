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
 *   reads as the int `1`.
 */

import { externKey } from '../../definition/extern-key.ts';
import type { Value } from '../../definition/values.ts';
import { type Native, type Natives, Panic } from '../../runtime/natives.ts';
import { preludeName } from '../stdlib-loader.ts';

type Primitive = 'int' | 'float' | 'string' | 'bool';

/** A float printed as whole digits, which needs `.0` to read as a float. */
const wholeDigits = /^-?\d+$/u;

const numericPairs = [
  ['int', 'int'],
  ['float', 'float'],
  ['int', 'float'],
  ['float', 'int'],
] as const;

interface ArgumentTypes {
  readonly bigint: bigint;
  readonly number: number;
  readonly string: string;
}

/** An argument read as the JavaScript type `name`; anything else is a bug in lowering or loading. */
function argumentOf<Name extends keyof ArgumentTypes>(
  name: Name,
): (value: Value | undefined) => ArgumentTypes[Name] {
  return (value) => {
    if (typeof value !== name) {
      throw new TypeError(`Expected a ${name}, got ${typeof value}.`);
    }
    return value as ArgumentTypes[Name];
  };
}

const int = argumentOf('bigint');
const float = argumentOf('number');
const text = argumentOf('string');

const floatDivide = (left: number, right: number): number => left / nonZero(right);

export const preludeNatives: Natives = {
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
  [key('floorDivide', 'int', 'int')]: ([left, right]) =>
    floorDivide(int(left), nonZero(int(right))),
  [key('remainder', 'int', 'int')]: ([left, right]) => {
    const dividend = int(left);
    const by = nonZero(int(right));
    return dividend - floorDivide(dividend, by) * by;
  },
  [key('negate', 'int')]: ([value]) => -int(value),
  [key('negate', 'float')]: ([value]) => -float(value),
  [key('compare', 'string', 'string')]: ([left, right]) =>
    sign(compareOrdered(text(left), text(right))),
  ...Object.fromEntries(
    (['string', 'int', 'float', 'bool'] as const).map((right) => [
      key('add', 'string', right),
      ([left, value]: readonly Value[]) => text(left) + appendedText(value),
    ]),
  ),
  [key('panic', 'string')]: ([message]) => {
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
      key(name, left, right),
      left === 'int' && right === 'int'
        ? ([a, b]) => onInts(int(a), int(b))
        : ([a, b]) => onFloats(asFloat(a), asFloat(b)),
    ]),
  );
}

/** The key prelude.ista's declaration of `name` over `parameters` gets. */
function key(name: string, ...parameters: readonly Primitive[]): string {
  return externKey({
    module: preludeName,
    name,
    parameters: parameters.map((type) => ({
      type: { kind: 'primitive', name: type },
      reference: false,
    })),
  });
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
