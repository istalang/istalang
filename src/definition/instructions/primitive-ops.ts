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
import { languageModules } from '../../foundation/language/well-known/index.ts';
import { nativeKeysOf } from '../extern-key.ts';

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

const prelude = nativeKeysOf(languageModules.prelude);

/** The prelude extern, by its key, each primitive operation stands for. */
export const primitiveOfExtern: Readonly<Record<string, PrimitiveOp>> = {
  [prelude.of('add', 'Int', 'Int')]: 'intAdd',
  [prelude.of('subtract', 'Int', 'Int')]: 'intSubtract',
  [prelude.of('multiply', 'Int', 'Int')]: 'intMultiply',
  [prelude.of('floorDivide', 'Int', 'Int')]: 'intFloorDivide',
  [prelude.of('remainder', 'Int', 'Int')]: 'intRemainder',
  [prelude.of('power', 'Int', 'Int')]: 'intPower',
  [prelude.of('negate', 'Int')]: 'intNegate',
  [prelude.of('compare', 'Int', 'Int')]: 'intCompare',
  [prelude.of('bitAnd', 'Int', 'Int')]: 'intBitAnd',
  [prelude.of('bitOr', 'Int', 'Int')]: 'intBitOr',
  [prelude.of('bitXor', 'Int', 'Int')]: 'intBitXor',
  [prelude.of('bitNot', 'Int')]: 'intBitNot',
  [prelude.of('shiftLeft', 'Int', 'Int')]: 'intShiftLeft',
  [prelude.of('shiftRight', 'Int', 'Int')]: 'intShiftRight',
  [prelude.of('add', 'Float', 'Float')]: 'floatAdd',
  [prelude.of('subtract', 'Float', 'Float')]: 'floatSubtract',
  [prelude.of('multiply', 'Float', 'Float')]: 'floatMultiply',
  [prelude.of('divide', 'Float', 'Float')]: 'floatDivide',
  [prelude.of('power', 'Float', 'Float')]: 'floatPower',
  [prelude.of('negate', 'Float')]: 'floatNegate',
  [prelude.of('compare', 'Float', 'Float')]: 'floatCompare',
  [prelude.of('add', 'String', 'String')]: 'stringConcat',
  [prelude.of('compare', 'String', 'String')]: 'stringCompare',
  [prelude.ofStatic('Float', 'from', 'Int')]: 'floatFromInt',
  [prelude.ofStatic('Int', 'from', 'Float')]: 'intFromFloat',
};
