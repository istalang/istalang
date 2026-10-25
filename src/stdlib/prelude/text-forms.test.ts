/**
 * The primitives' text forms (§3.10): `parse` reads back every text `toString` writes, for any
 * value, and refuses text that isn't one, whatever it is, without throwing.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { primitiveText, readPrimitive } from './text-forms.ts';

const wholeFloat = /\.0$|e/u;
const intSyntax = /^[+-]?\d+$/u;

describe('primitive text forms', () => {
  it('read back every int, float and bool as written', () => {
    fc.assert(
      fc.property(fc.bigInt(), (value) => {
        expect(readPrimitive('int', primitiveText(value))).toBe(value);
      }),
    );
    fc.assert(
      fc.property(fc.double(), (value) => {
        // JavaScript writes -0 as 0, and so does toString.
        expect(readPrimitive('float', primitiveText(value))).toBe(Object.is(value, -0) ? 0 : value);
      }),
    );
    for (const value of [true, false]) {
      expect(readPrimitive('bool', primitiveText(value))).toBe(value);
    }
  });

  it('keep a whole float distinct from an int', () => {
    fc.assert(
      fc.property(fc.integer(), (whole) => {
        expect(primitiveText(whole)).toMatch(wholeFloat);
        expect(readPrimitive('int', primitiveText(whole))).toBeUndefined();
      }),
    );
  });

  it('refuse any other text without throwing', () => {
    fc.assert(
      fc.property(fc.string(), (source) => {
        const int = readPrimitive('int', source);
        expect(int === undefined || intSyntax.test(source)).toBe(true);
        const bool = readPrimitive('bool', source);
        expect(bool === undefined || source === 'true' || source === 'false').toBe(true);
        expect(() => readPrimitive('float', source)).not.toThrow();
      }),
    );
    for (const source of ['', ' 1', '1 ', '0x10', '1_000', 'True', '1e', '--1', 'nan']) {
      expect(readPrimitive('int', source)).toBeUndefined();
      expect(readPrimitive('float', source)).toBeUndefined();
    }
  });
});
