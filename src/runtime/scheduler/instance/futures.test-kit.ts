/** Futures a test makes alone: what their resolving decides or answers goes nowhere. */

import { Futures } from './futures.ts';
import type { Heap } from './heap.ts';
import { Waits } from './waits.ts';

/** Futures on `heap`, their decisions and answers ignored. */
export function futuresOn(heap: Heap): Futures {
  const waits = new Waits(heap, { decided: () => undefined, watchesCall: () => false });
  return new Futures(heap, waits, () => undefined);
}
