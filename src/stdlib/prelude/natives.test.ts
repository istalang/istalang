/**
 * The prelude's natives, right on any input: checked as properties of integer and float arithmetic
 * rather than a few chosen values. Their binding to the declared externs is checked with every std
 * module's (stdlib/natives.test.ts).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Value } from '../../definition/values.ts';
import { languageModules } from '../../language/well-known.ts';
import { Panic } from '../../runtime/natives.ts';
import { unusedContext } from '../../runtime/runtime.test-kit.ts';
import { nativeKeysOf } from '../std-module.ts';
import { preludeNatives } from './natives.ts';

const keys = nativeKeysOf(languageModules.prelude);
const natives = preludeNatives(keys);

function call(key: string, ...argumentValues: Value[]): Value {
  const native = natives[key];
  if (native === undefined) {
    throw new Error(`No native ${key}.`);
  }
  return native(argumentValues, unusedContext);
}

const nonZero = fc.bigInt().filter((value) => value !== 0n);
const finite = fc.double({ noNaN: true, noDefaultInfinity: true });

describe('prelude natives', () => {
  it('keep integer arithmetic exact at any size', () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt(), (left, right) => {
        expect(call(keys.of('add', 'Int', 'Int'), left, right)).toBe(left + right);
        expect(call(keys.of('subtract', 'Int', 'Int'), left, right)).toBe(left - right);
        expect(call(keys.of('multiply', 'Int', 'Int'), left, right)).toBe(left * right);
      }),
    );
  });

  it('floor and take the divisor sign, so a == (a // b) * b + a % b', () => {
    fc.assert(
      fc.property(fc.bigInt(), nonZero, (dividend, divisor) => {
        const quotient = call(keys.of('floorDivide', 'Int', 'Int'), dividend, divisor) as bigint;
        const rest = call(keys.of('remainder', 'Int', 'Int'), dividend, divisor) as bigint;
        expect(quotient * divisor + rest).toBe(dividend);
        expect(rest === 0n || rest < 0n === divisor < 0n).toBe(true);
        expect(rest < 0n ? -rest : rest).toBeLessThan(divisor < 0n ? -divisor : divisor);
      }),
    );
  });

  it('panic on integer division by zero', () => {
    fc.assert(
      fc.property(fc.bigInt(), (dividend) => {
        for (const name of ['floorDivide', 'remainder']) {
          expect(() => call(keys.of(name, 'Int', 'Int'), dividend, 0n)).toThrow(Panic);
        }
      }),
    );
  });

  it('divide by zero as IEEE 754 does, whatever the operand types', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 50n), max: 2n ** 50n }), finite, (whole, fraction) => {
        const cases = [
          [keys.of('divide', 'Int', 'Int'), whole, 0n, Number(whole) / 0],
          [keys.of('divide', 'Int', 'Float'), whole, -0, Number(whole) / -0],
          [keys.of('divide', 'Float', 'Int'), fraction, 0n, fraction / 0],
          [keys.of('divide', 'Float', 'Float'), fraction, 0, fraction / 0],
        ] as const;
        for (const [key, dividend, zero, quotient] of cases) {
          expect(call(key, dividend, zero)).toBe(quotient);
        }
      }),
    );
  });

  it('mix ints into floats, and always divide as floats', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 50n), max: 2n ** 50n }), finite, (whole, fraction) => {
        expect(call(keys.of('add', 'Int', 'Float'), whole, fraction)).toBe(
          Number(whole) + fraction,
        );
        expect(call(keys.of('multiply', 'Float', 'Int'), fraction, whole)).toBe(
          fraction * Number(whole),
        );
      }),
    );
    expect(call(keys.of('divide', 'Int', 'Int'), 7n, 2n)).toBe(3.5);
  });

  it('compare consistently with the order of the values', () => {
    const consistent = <T>(key: string, left: T & Value, right: T & Value, less: boolean) => {
      const forward = call(key, left, right) as bigint;
      const backward = call(key, right, left) as bigint;
      expect(forward).toBe(-backward);
      expect(forward < 0n).toBe(less);
    };
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt(), (left, right) => {
        consistent(keys.of('compare', 'Int', 'Int'), left, right, left < right);
      }),
    );
    fc.assert(
      fc.property(finite, finite, (left, right) => {
        consistent(keys.of('compare', 'Float', 'Float'), left, right, left < right);
      }),
    );
    fc.assert(
      fc.property(fc.string(), fc.string(), (left, right) => {
        consistent(keys.of('compare', 'String', 'String'), left, right, left < right);
      }),
    );
  });

  it('panic with the message panic was given', () => {
    expect(() => call('prelude.panic(String)', 'bug')).toThrow(new Panic('bug'));
  });
});
