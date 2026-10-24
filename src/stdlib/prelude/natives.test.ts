/**
 * The prelude's natives, right on any input: checked as properties of integer and float arithmetic
 * rather than a few chosen values. Their binding to the declared externs is checked with every std
 * module's (stdlib/natives.test.ts).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Value } from '../../definition/values.ts';
import { Panic } from '../../runtime/natives.ts';
import { unusedContext } from '../../runtime/runtime.test-kit.ts';
import { preludeKey, preludeNatives } from './natives.ts';

function call(key: string, ...argumentValues: Value[]): Value {
  const native = preludeNatives[key];
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
        expect(call(preludeKey('add', 'int', 'int'), left, right)).toBe(left + right);
        expect(call(preludeKey('subtract', 'int', 'int'), left, right)).toBe(left - right);
        expect(call(preludeKey('multiply', 'int', 'int'), left, right)).toBe(left * right);
      }),
    );
  });

  it('floor and take the divisor sign, so a == (a // b) * b + a % b', () => {
    fc.assert(
      fc.property(fc.bigInt(), nonZero, (dividend, divisor) => {
        const quotient = call(preludeKey('floorDivide', 'int', 'int'), dividend, divisor) as bigint;
        const rest = call(preludeKey('remainder', 'int', 'int'), dividend, divisor) as bigint;
        expect(quotient * divisor + rest).toBe(dividend);
        expect(rest === 0n || rest < 0n === divisor < 0n).toBe(true);
        expect(rest < 0n ? -rest : rest).toBeLessThan(divisor < 0n ? -divisor : divisor);
      }),
    );
  });

  it('panic on division by zero, for ints and floats alike', () => {
    for (const [key, zero] of [
      [preludeKey('floorDivide', 'int', 'int'), 0n],
      [preludeKey('remainder', 'int', 'int'), 0n],
      [preludeKey('divide', 'int', 'int'), 0n],
      [preludeKey('divide', 'float', 'float'), 0],
      [preludeKey('divide', 'float', 'int'), 0n],
    ] as const) {
      const dividend = key.includes('float, ') ? 1.5 : 1n;
      expect(() => call(key, dividend, zero)).toThrow(Panic);
    }
  });

  it('mix ints into floats, and always divide as floats', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 50n), max: 2n ** 50n }), finite, (whole, fraction) => {
        expect(call(preludeKey('add', 'int', 'float'), whole, fraction)).toBe(
          Number(whole) + fraction,
        );
        expect(call(preludeKey('multiply', 'float', 'int'), fraction, whole)).toBe(
          fraction * Number(whole),
        );
      }),
    );
    expect(call(preludeKey('divide', 'int', 'int'), 7n, 2n)).toBe(3.5);
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
        consistent(preludeKey('compare', 'int', 'int'), left, right, left < right);
      }),
    );
    fc.assert(
      fc.property(finite, finite, (left, right) => {
        consistent(preludeKey('compare', 'float', 'float'), left, right, left < right);
      }),
    );
    fc.assert(
      fc.property(fc.string(), fc.string(), (left, right) => {
        consistent(preludeKey('compare', 'string', 'string'), left, right, left < right);
      }),
    );
  });

  it('append the text of a primitive to a string, a whole float keeping its .0', () => {
    expect(call(preludeKey('add', 'string', 'int'), 'n=', 42n)).toBe('n=42');
    expect(call(preludeKey('add', 'string', 'float'), 'x=', 2)).toBe('x=2.0');
    expect(call(preludeKey('add', 'string', 'float'), 'x=', 2.5)).toBe('x=2.5');
    expect(call(preludeKey('add', 'string', 'float'), 'x=', 1e21)).toBe('x=1e+21');
    expect(call(preludeKey('add', 'string', 'bool'), 'ok ', true)).toBe('ok true');
  });

  it('panic with the message panic was given', () => {
    expect(() => call('prelude.panic(string)', 'bug')).toThrow(new Panic('bug'));
  });
});
