/**
 * Function values are equal when they run the same body with equal captures (§3.14): a body is a
 * declared function, lambda or local function, whatever its instantiation, whether lowering shared
 * that instance across types or made one per type (tables.ts `body`, definition/values/equality.ts).
 */

import { describe, expect, it } from 'vitest';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
import { wholeProgramTimeout } from '../../compile.test-kit.ts';

const declarations = [
  'fn made<T>(x: T) -> fn() -> Int: fn() -> Int: 1',
  'fn madeOptional<T>(x: T?) -> fn() -> Int: fn() -> Int: 1',
  'fn other() -> fn() -> Int: fn() -> Int: 1',
  'fn capturing<T>(x: T, n: Int) -> fn() -> Int: fn() -> Int: n',
  'fn named<T>(n: Int) -> Int: n',
].join('\n');

describe('two function values', () => {
  it.each([
    ['of one lambda in instances of two lifetime classes', 'made(1) == made([1])', true],
    [
      'of one lambda in instances a union keeps apart',
      'madeOptional(1) == madeOptional("a")',
      true,
    ],
    ['of one function named at two types', 'named<Int> == named<String>', true],
    ['of two lambdas written alike', 'made(1) == other()', false],
    ['of one lambda with captures that differ', 'capturing(1, 1) == capturing([1], 2)', false],
  ])(
    'are equal as their body and captures are: %s',
    async (_, comparison, equal) => {
      expect(await mainGives('Bool', comparison, declarations)).toBe(equal);
    },
    wholeProgramTimeout,
  );

  it(
    'of one body are one map key',
    async () => {
      const body = 'const keyed = [made(1): 1, made([1]): 2]\nkeyed.size()';
      expect(await mainGives('Int', body, declarations)).toBe(1);
    },
    wholeProgramTimeout,
  );
});
