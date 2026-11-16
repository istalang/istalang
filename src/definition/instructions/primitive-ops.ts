/**
 * The primitive operations every backend implements in its own code, inline, never as a call
 * (ir-first design, decision 8): arithmetic, comparison and conversion of `Int`, `Float` and
 * `String`, so an `Int` loop runs as fast as hand-written code over the same representation.
 *
 * Each is the prelude extern it stands for (`primitiveOfExtern`), which lowering replaces by the
 * operation: the extern keeps its declaration, so operators resolve like any call, and has no
 * native. Mixed operands (`Int + Float`) are Istalang overloads over `Float.from`, so every
 * operation takes operands of one type.
 *
 * - `Int` is unbounded; `floorDivide` rounds toward negative infinity and `remainder` takes the
 *   divisor's sign, each panicking on a zero divisor; bitwise operations are on an unbounded two's
 *   complement; a negative shift count or power exponent panics.
 * - `compare` gives a negative, zero or positive `Int`: `Float` NaN compares equal to NaN and below
 *   every number, `String` compares UTF-16 code units.
 * - `Int.from` truncates toward zero, panicking on NaN and the infinities.
 */

import { z } from 'zod';

export const primitiveOp = z.enum([
  'intAdd',
  'intSubtract',
  'intMultiply',
  'intFloorDivide',
  'intRemainder',
  'intPower',
  'intNegate',
  'intCompare',
  'intBitAnd',
  'intBitOr',
  'intBitXor',
  'intBitNot',
  'intShiftLeft',
  'intShiftRight',
  'floatAdd',
  'floatSubtract',
  'floatMultiply',
  'floatDivide',
  'floatPower',
  'floatNegate',
  'floatCompare',
  'stringConcat',
  'stringCompare',
  'floatFromInt',
  'intFromFloat',
]);

export type PrimitiveOp = z.output<typeof primitiveOp>;

/** The prelude extern, by its key, each primitive operation stands for. */
export const primitiveOfExtern: Readonly<Record<string, PrimitiveOp>> = {
  'prelude.add(Int, Int)': 'intAdd',
  'prelude.subtract(Int, Int)': 'intSubtract',
  'prelude.multiply(Int, Int)': 'intMultiply',
  'prelude.floorDivide(Int, Int)': 'intFloorDivide',
  'prelude.remainder(Int, Int)': 'intRemainder',
  'prelude.power(Int, Int)': 'intPower',
  'prelude.negate(Int)': 'intNegate',
  'prelude.compare(Int, Int)': 'intCompare',
  'prelude.bitAnd(Int, Int)': 'intBitAnd',
  'prelude.bitOr(Int, Int)': 'intBitOr',
  'prelude.bitXor(Int, Int)': 'intBitXor',
  'prelude.bitNot(Int)': 'intBitNot',
  'prelude.shiftLeft(Int, Int)': 'intShiftLeft',
  'prelude.shiftRight(Int, Int)': 'intShiftRight',
  'prelude.add(Float, Float)': 'floatAdd',
  'prelude.subtract(Float, Float)': 'floatSubtract',
  'prelude.multiply(Float, Float)': 'floatMultiply',
  'prelude.divide(Float, Float)': 'floatDivide',
  'prelude.power(Float, Float)': 'floatPower',
  'prelude.negate(Float)': 'floatNegate',
  'prelude.compare(Float, Float)': 'floatCompare',
  'prelude.add(String, String)': 'stringConcat',
  'prelude.compare(String, String)': 'stringCompare',
  'prelude.Float.from(Int)': 'floatFromInt',
  'prelude.Int.from(Float)': 'intFromFloat',
};
