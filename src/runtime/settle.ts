/**
 * Driving an instance until it settles (§9): wake it whenever its next timer is due, until it
 * finishes or panics, or waits on nothing a timer can wake.
 *
 * Every host needs this loop, but each waits for a time its own way: a test moves a manual clock,
 * the CLI sleeps. So the loop is a generator that yields each time to wait until; the caller waits
 * however it does, then resumes it. The loop, and the case of an instance nothing can wake, live
 * here once.
 */

import type { InstanceState } from './instance-state.ts';

/** How driving an instance ended: finished, panicked, or `stuck` waiting on nothing a timer wakes. */
export type Settled = Exclude<InstanceState, { kind: 'waiting' }> | { readonly kind: 'stuck' };

/**
 * Yields each time `initial` and its successors wait until, calling `wake` once the caller resumes
 * after that time; returns how the instance settled.
 */
export function* settle(
  wake: () => InstanceState,
  initial: InstanceState,
): Generator<bigint, Settled, void> {
  let state = initial;
  while (state.kind === 'waiting') {
    if (state.until === undefined) {
      return { kind: 'stuck' };
    }
    yield state.until;
    state = wake();
  }
  return state;
}
