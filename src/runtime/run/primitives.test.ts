/**
 * The primitive operations as compiled code runs them (codegen/primitives.ts, calling primitives.ts
 * where one panics or differs from JavaScript's operator), right on any input: checked as
 * properties of integer and float arithmetic rather than a few chosen values.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { primitiveExpressions } from '../../codegen/primitives.ts';
import type { PrimitiveOp } from '../../definition/instructions/primitive-ops.ts';
import { Panic } from '../natives.ts';
import { calledPrimitives } from './primitives.ts';

/** What `op` gives on `operands`, run as the code codegen writes for it. */
function computed(op: PrimitiveOp, ...operands: readonly unknown[]): unknown {
  const names = operands.map((_, index) => `operand${index}`);
  const helpers = Object.keys(calledPrimitives);
  const code = `return ${primitiveExpressions[op](names)};`;
  const compiled = new Function(...helpers, ...names, code);
  return compiled(...Object.values(calledPrimitives), ...operands);
}

const nonZero = fc.bigInt().filter((value) => value !== 0n);
const finite = fc.double({ noNaN: true, noDefaultInfinity: true });

describe('primitive operations', () => {
  it('keep integer arithmetic exact at any size', () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt(), (left, right) => {
        expect(computed('intAdd', left, right)).toBe(left + right);
        expect(computed('intSubtract', left, right)).toBe(left - right);
        expect(computed('intMultiply', left, right)).toBe(left * right);
      }),
    );
  });

  it('floor and take the divisor sign, so a == (a // b) * b + a % b', () => {
    fc.assert(
      fc.property(fc.bigInt(), nonZero, (dividend, divisor) => {
        const quotient = computed('intFloorDivide', dividend, divisor) as bigint;
        const rest = computed('intRemainder', dividend, divisor) as bigint;
        expect(quotient * divisor + rest).toBe(dividend);
        expect(rest === 0n || rest < 0n === divisor < 0n).toBe(true);
        expect(rest < 0n ? -rest : rest).toBeLessThan(divisor < 0n ? -divisor : divisor);
      }),
    );
  });

  it('panic on integer division by zero', () => {
    fc.assert(
      fc.property(fc.bigInt(), (dividend) => {
        for (const op of ['intFloorDivide', 'intRemainder'] as const) {
          expect(() => computed(op, dividend, 0n)).toThrow(new Panic('Division by zero.'));
        }
      }),
    );
  });

  it('divide floats by zero as IEEE 754 does', () => {
    fc.assert(
      fc.property(finite, (fraction) => {
        for (const zero of [0, -0]) {
          expect(computed('floatDivide', fraction, zero)).toBe(fraction / zero);
        }
      }),
    );
  });

  it('compare consistently with the order of the values', () => {
    const consistent = <T>(op: PrimitiveOp, left: T, right: T, less: boolean) => {
      const forward = computed(op, left, right) as bigint;
      const backward = computed(op, right, left) as bigint;
      expect(forward).toBe(-backward);
      expect(forward < 0n).toBe(less);
    };
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt(), (left, right) => {
        consistent('intCompare', left, right, left < right);
      }),
    );
    fc.assert(
      fc.property(finite, finite, (left, right) => {
        consistent('floatCompare', left, right, left < right);
      }),
    );
    fc.assert(
      fc.property(fc.string(), fc.string(), (left, right) => {
        consistent('stringCompare', left, right, left < right);
      }),
    );
  });
});
