/**
 * Each primitive operation as inline JavaScript over its operands' expressions
 * (definition/instructions/primitive-ops.ts), so an `Int` loop runs as hand-written bigint code.
 *
 * An `Int` is a bigint and a `Float` a number, so most operations are one operator. Those that can
 * panic (a zero divisor, a negative shift or exponent, a float that is no number) or whose rule
 * differs from the operator's (floor division, a float's NaN ordering) call the runtime's helper
 * of the same name, which panics with the language's message.
 */

import type { PrimitiveOp } from '../definition/instructions/primitive-ops.ts';

const compare = (left: string, right: string) =>
  `(${left} < ${right} ? -1n : ${left} > ${right} ? 1n : 0n)`;

/** The expression computing `op` over `operands`, each an expression. */
export const primitiveExpressions: Readonly<
  Record<PrimitiveOp, (operands: readonly string[]) => string>
> = {
  intAdd: ([a, b]) => `${a} + ${b}`,
  intSubtract: ([a, b]) => `${a} - ${b}`,
  intMultiply: ([a, b]) => `${a} * ${b}`,
  intFloorDivide: ([a, b]) => `floorDivide(${a}, ${b})`,
  intRemainder: ([a, b]) => `remainder(${a}, ${b})`,
  intPower: ([a, b]) => `intPower(${a}, ${b})`,
  intNegate: ([a]) => `-${a}`,
  intCompare: ([a, b]) => compare(a ?? '', b ?? ''),
  intBitAnd: ([a, b]) => `${a} & ${b}`,
  intBitOr: ([a, b]) => `${a} | ${b}`,
  intBitXor: ([a, b]) => `${a} ^ ${b}`,
  intBitNot: ([a]) => `~${a}`,
  intShiftLeft: ([a, b]) => `shiftLeft(${a}, ${b})`,
  intShiftRight: ([a, b]) => `shiftRight(${a}, ${b})`,
  floatAdd: ([a, b]) => `${a} + ${b}`,
  floatSubtract: ([a, b]) => `${a} - ${b}`,
  floatMultiply: ([a, b]) => `${a} * ${b}`,
  floatDivide: ([a, b]) => `${a} / ${b}`,
  floatPower: ([a, b]) => `${a} ** ${b}`,
  floatNegate: ([a]) => `-${a}`,
  floatCompare: ([a, b]) => `floatCompare(${a}, ${b})`,
  stringConcat: ([a, b]) => `${a} + ${b}`,
  stringCompare: ([a, b]) => compare(a ?? '', b ?? ''),
  floatFromInt: ([a]) => `Number(${a})`,
  intFromFloat: ([a]) => `intFromFloat(${a})`,
};
