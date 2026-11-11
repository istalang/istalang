/** Futures a test makes alone: what their resolving decides, calls back or answers goes nowhere. */

import { Futures } from './futures.ts';
import type { Heap } from './heap.ts';
import { Waits } from './waits.ts';

/** Futures on `heap`, their decisions, callbacks and answers ignored. */
export function futuresOn(heap: Heap): Futures {
  const waits = new Waits(heap, {
    decided: () => undefined,
    watchesCall: () => false,
    called: () => undefined,
  });
  return new Futures(heap, waits, () => undefined);
}
