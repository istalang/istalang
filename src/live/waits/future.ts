/**
 * A future of a run of compiled code (spec §6): it resolves once and stays resolved. Who waits on
 * it is the resolvers registered on it, which the run's waits find by it (waits.ts), as the
 * interpreter's heap indexes them.
 */

import type { Value } from '../../definition/values/values.ts';
import { newObject } from '../values/cell.ts';

export class Future {
  readonly kind = 'handle';
  readonly object = newObject();
  settled: { readonly value: Value } | undefined;
}
