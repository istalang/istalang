/**
 * The `Rounding` enum (math.ista) as natives read it: its variants by declared name, which `math`
 * rounds floats with and `decimal` rounds decimals with, each through a table over every name, so
 * a variant one of them misses fails to compile.
 *
 * A float rounds in its own binary value, and keeps the sign of a zero it rounds to, as IEEE 754's
 * roundToIntegral does (`round(-0.4)` is `-0.0`). `x % 1` is exact, so it finds a tie exactly;
 * `Math.round` gives every other case, and the upper neighbour of a tie.
 */

import type { KeyType } from '../../definition/extern-key.ts';
import type { NativeKeys } from '../std-module.ts';

/** A `Rounding` variant, by its declared name. */
export type Rounding =
  | 'Floor'
  | 'Ceiling'
  | 'TowardZero'
  | 'AwayFromZero'
  | 'HalfEven'
  | 'HalfAwayFromZero';

/** The key type of `math.Rounding`, from the keys of the `math` module. */
export function roundingType(mathKeys: NativeKeys): KeyType {
  return mathKeys.type('Rounding');
}

const half = 0.5;

/** Whether `x` lies exactly halfway between two integers. */
function isTie(x: number): boolean {
  return Math.abs(x % 1) === half;
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the enum's variant names.
/** How each mode rounds a float to an integral float. */
export const floatRoundings = {
  Floor: Math.floor,
  Ceiling: Math.ceil,
  TowardZero: Math.trunc,
  AwayFromZero: (x) => Math.sign(x) * Math.ceil(Math.abs(x)),
  HalfEven: (x) => {
    const upper = Math.round(x);
    return isTie(x) && upper % 2 !== 0 ? upper - 1 : upper;
  },
  HalfAwayFromZero: (x) => Math.sign(x) * Math.round(Math.abs(x)),
} as const satisfies Record<Rounding, (x: number) => number>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the enum's variant names.
