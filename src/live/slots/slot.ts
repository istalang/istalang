/**
 * A slot of a run of compiled code (spec §6): empty, or full with one value, and the operations
 * waiting on it, longest first (slots.ts serves them).
 */

import type { Value } from '../../definition/values/values.ts';
import { newObject } from '../values/cell.ts';
import type { Future } from '../waits/future.ts';

export class Slot {
  readonly kind = 'handle';
  readonly object = newObject();
  /** Its value, present exactly when it is full. */
  contents: { readonly value: Value } | undefined;
  /** The futures of the operations waiting, longest first. */
  waiting: Future[] = [];
}
