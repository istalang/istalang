/**
 * decimal.js as an oracle for tests (a dev dependency only): the std's numbers are written in
 * Istalang, and tests hold them to an independent implementation.
 */

import { Decimal } from 'decimal.js';
import type { Rounding } from '../math/rounding.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the enum's variant names.
/** Each `Rounding` mode (math.ista) as decimal.js numbers it. */
export const decimalJsRoundings = {
  Floor: Decimal.ROUND_FLOOR,
  Ceiling: Decimal.ROUND_CEIL,
  TowardZero: Decimal.ROUND_DOWN,
  AwayFromZero: Decimal.ROUND_UP,
  HalfEven: Decimal.ROUND_HALF_EVEN,
  HalfAwayFromZero: Decimal.ROUND_HALF_UP,
} as const satisfies Record<Rounding, Decimal.Rounding>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the enum's variant names.
