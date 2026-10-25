/**
 * The key of a prelude extern over primitive parameters, as every prelude natives table spells it.
 * It has a module of its own so the tables split by concern can share it without importing each
 * other.
 */

import { nativeKey, primitiveKey } from '../../definition/extern-key.ts';
import type { PrimitiveName } from '../../language/primitives.ts';
import { preludeName } from '../stdlib-loader.ts';

/** The key prelude.ista's declaration of `name` over primitive `parameters` gets. */
export function preludeKey(name: string, ...parameters: readonly PrimitiveName[]): string {
  return nativeKey(preludeName, name, ...parameters.map(primitiveKey));
}
