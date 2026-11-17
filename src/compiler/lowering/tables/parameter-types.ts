/**
 * The type of the register a parameter's argument arrives in, for every entry that takes one:
 * its own, or, for a `&` parameter (§3.7), a reference to it, which the callee reads and writes
 * through.
 */

import type { TypeReference } from '../../../definition/tables/types.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { TypeTable } from './type-table.ts';

/** A parameter as an entry takes it: its type, and whether it is taken by `&`. */
interface TakenParameter {
  readonly type: Type;
  readonly reference: boolean;
}

/** The type `parameter`'s argument arrives in, as `types` refers to it. */
export function parameterTypeOf(
  types: TypeTable,
  { type, reference }: TakenParameter,
): TypeReference {
  const referred = types.reference(type);
  return reference ? { kind: 'reference', to: referred } : referred;
}
