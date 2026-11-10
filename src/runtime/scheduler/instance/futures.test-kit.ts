/** Futures a test makes alone: what their resolving decides or answers goes nowhere. */

import { Futures } from './futures.ts';
import type { Heap } from './heap.ts';
import { Resolvers } from './resolvers.ts';

/** Futures on `heap`, their decisions and answers ignored. */
export function futuresOn(heap: Heap): Futures {
  return new Futures(heap, new Resolvers(heap, () => undefined), () => undefined);
}
