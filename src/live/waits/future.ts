/**
 * A future of a run of compiled code (spec §6): it resolves once and stays resolved. Who waits on
 * it is the resolvers registered on it, which the run's waits find by it (waits.ts), as the
 * interpreter's heap indexes them.
 *
 * Its origin says what disposing it does (live/lifetimes/disposal.ts): an async call's stops the
 * call, a host's tells the host, and one a timer, a watch or nothing fills is simply gone.
 */

import type { Value } from '../../definition/values/values.ts';
import { newObject } from '../values/cell.ts';

/**
 * What resolves a future: its async call returning, a host's resolver, a timer, a weak reference's
 * watch, or nothing, made resolved.
 */
export type FutureOrigin = 'call' | 'host' | 'timer' | 'watch' | 'given';

export class Future {
  readonly kind = 'handle';
  readonly object = newObject();
  readonly origin: FutureOrigin;
  settled: { readonly value: Value } | undefined;

  constructor(origin: FutureOrigin) {
    this.origin = origin;
  }
}
