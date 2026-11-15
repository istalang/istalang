/**
 * A future of a run of compiled code (spec §6): it resolves once and stays resolved. Who waits on
 * it is the resolvers registered on it, which the run's waits find by it (waits.ts), as the
 * interpreter's heap indexes them.
 *
 * A future standing for an operation on a slot carries that operation until the slot serves it
 * (../slots/slots.ts).
 */

import type { Value } from '../../definition/values/values.ts';
import { newObject } from '../values/cell.ts';

/** A pending operation on a slot. */
export interface SlotOperation {
  readonly operation: 'put' | 'take' | 'read';
  readonly value: Value;
  /** Whether a losing case awaited it (spec §8), so serving passes it over while nothing awaits it. */
  givenUp: boolean;
}

export class Future {
  readonly kind = 'handle';
  readonly object = newObject();
  settled: { readonly value: Value } | undefined;
  /** The slot operation it stands for, while pending. */
  readonly slot: SlotOperation | undefined;

  constructor(slot?: SlotOperation) {
    this.slot = slot;
  }

  /** A losing case awaited it: a slot operation is given up on. */
  giveUp(): void {
    if (this.slot !== undefined) {
      this.slot.givenUp = true;
    }
  }
}
