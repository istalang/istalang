/**
 * The `decimal` module's natives (decimal.ista), over the arithmetic of arithmetic.ts.
 *
 * A `Decimal` is a value of an extern type whose payload is its canonical text, the one form
 * `toString` writes and a snapshot keeps: every native reads its operands from that text and writes
 * its result back as text, so no other form can reach `==`. An `int` operand reads as its digits.
 */

import type { KeyType, NativeParameter } from '../../definition/extern-key.ts';
import type { Value } from '../../definition/values.ts';
import { conversionFunction } from '../../language/well-known.ts';
import type { Native, NativeContext, Natives } from '../../runtime/natives.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { roundingType } from '../math/rounding.ts';
import {
  externOf,
  int,
  parseResult,
  payloadOf,
  resultExtern,
  resultTypeArgument,
  text,
  variantEntry,
} from '../native-values.ts';
import type { NativeKeys } from '../std-module.ts';
import {
  canonicalText,
  type Decimal,
  type DecimalRounding,
  decimalOf,
  decimalRoundings,
  divided,
  dividedTo,
  fixedText,
  floorDivided,
  nearestFloat,
  power,
  readDecimal,
  remainderOf,
  roundedTo,
  truncatedInt,
} from './arithmetic.ts';

/** The name the module declares its type by (decimal.ista). */
const typeName = 'Decimal';

/** An operation on two numbers, given the arguments after them (`divide`'s places and mode). */
type Operation = (
  left: Decimal,
  right: Decimal,
  context: NativeContext,
  rest: readonly (Value | undefined)[],
) => Value;

/** The natives of `decimal`, whose `Rounding` is the `math` module's, keyed by `mathKeys`. */
export const decimalNatives = (keys: NativeKeys, mathKeys: NativeKeys): Natives<NativeContext> => {
  const decimal = keys.type(typeName);
  const rounding = roundingType(mathKeys);
  const mixed = mixedOverloads(keys, decimal);
  return {
    [keys.ofStatic(typeName, conversionFunction, 'int')]: ([value], context) =>
      decimalResult(context, decimalOf(int(value))),
    [keys.ofStatic('int', conversionFunction, decimal)]: ([value]) => truncatedInt(operand(value)),
    [keys.ofStatic('float', conversionFunction, decimal)]: ([value]) =>
      nearestFloat(operand(value)),
    [keys.of('toString', decimal)]: ([value]) => textOf(value),
    [keys.ofStatic(typeName, 'parse', 'string')]: ([source], context) => {
      const read = readDecimal(text(source));
      const value = read && externOf(resultTypeArgument(context, 0), canonicalText(read));
      return parseResult(context, text(source), 'a decimal number', value);
    },
    [keys.of('toFixed', decimal, 'int', rounding)]: ([value, places, mode], context) =>
      fixedText(operand(value), int(places), modeOf(context, mode)),
    ...mixed('add', (left, right, context) => decimalResult(context, left.plus(right))),
    ...mixed('subtract', (left, right, context) => decimalResult(context, left.minus(right))),
    ...mixed('multiply', (left, right, context) => decimalResult(context, left.times(right))),
    ...mixed('divide', (left, right, context) => decimalResult(context, divided(left, right))),
    ...mixed(
      'divide',
      (left, right, context, [places, mode]) =>
        decimalResult(context, dividedTo(left, right, int(places), modeOf(context, mode))),
      'int',
      rounding,
    ),
    ...mixed('floorDivide', (left, right, context) =>
      decimalResult(context, floorDivided(left, right)),
    ),
    ...mixed('remainder', (left, right, context) =>
      decimalResult(context, remainderOf(left, right)),
    ),
    ...mixed('compare', (left, right) => BigInt(left.cmp(right))),
    [keys.of('negate', decimal)]: ([value], context) =>
      decimalResult(context, operand(value).neg()),
    [keys.of('abs', decimal)]: ([value], context) => decimalResult(context, operand(value).abs()),
    [keys.of('round', decimal, 'int', rounding)]: ([value, places, mode], context) =>
      decimalResult(context, roundedTo(operand(value), int(places), modeOf(context, mode))),
    [keys.of('pow', decimal, 'int')]: ([value, exponent], context) =>
      decimalResult(context, power(operand(value), int(exponent))),
  };
};

/**
 * What builds the overloads of an operation taking a Decimal or an int on either side, then
 * `rest`, each reading both operands as decimals.
 */
function mixedOverloads(keys: NativeKeys, decimal: KeyType) {
  const pairs = [
    [decimal, decimal],
    [decimal, 'int'],
    ['int', decimal],
  ] as const;
  return (
    name: string,
    operation: Operation,
    ...rest: readonly NativeParameter[]
  ): Natives<NativeContext> => {
    const native: Native<NativeContext> = ([left, right, ...others], context) =>
      operation(operand(left), operand(right), context, others);
    return Object.fromEntries(
      pairs.map(([left, right]) => [keys.of(name, left, right, ...rest), native]),
    );
  };
}

/** A Decimal or an int argument, as a number. */
function operand(value: Value | undefined): Decimal {
  return decimalOf(typeof value === 'bigint' ? value : textOf(value));
}

/** A Decimal argument's canonical text, which is its payload. */
function textOf(value: Value | undefined): string {
  const payload = payloadOf(value);
  return typeof payload === 'string' ? payload : unreachable('A Decimal holds its text.');
}

/** A Decimal of the extern's declared result type. */
function decimalResult(context: NativeContext, value: Decimal): Value {
  return resultExtern(context, canonicalText(value));
}

function modeOf(context: NativeContext, mode: Value | undefined): DecimalRounding {
  return variantEntry(context, mode, decimalRoundings);
}
