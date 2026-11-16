/**
 * decimal.js as the oracle of rounding (a dev dependency only): the std's numbers and roundings
 * are written in Istalang, and tests hold them to an independent implementation.
 */

import { Decimal } from 'decimal.js';

/** A `math.Rounding` variant, by its declared name (math.ista). */
export type Rounding =
  | 'Floor'
  | 'Ceiling'
  | 'TowardZero'
  | 'AwayFromZero'
  | 'HalfEven'
  | 'HalfAwayFromZero';

// biome-ignore-start lint/style/useNamingConvention: the keys are the enum's variant names.
/** Each `Rounding` mode as decimal.js numbers it. */
export const decimalJsRoundings = {
  Floor: Decimal.ROUND_FLOOR,
  Ceiling: Decimal.ROUND_CEIL,
  TowardZero: Decimal.ROUND_DOWN,
  AwayFromZero: Decimal.ROUND_UP,
  HalfEven: Decimal.ROUND_HALF_EVEN,
  HalfAwayFromZero: Decimal.ROUND_HALF_UP,
} as const satisfies Record<Rounding, Decimal.Rounding>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the enum's variant names.

/** Every rounding mode. */
export const roundings = Object.keys(decimalJsRoundings) as Rounding[];
