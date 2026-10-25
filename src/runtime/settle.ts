/**
 * Driving instances until they settle (§9): wake each one when it is ready or its next timer is
 * due, until it finishes or panics, or waits on nothing a timer can wake. An instance a wake
 * spawned joins the group, so a program's spawned instances, and theirs, run with it.
 *
 * Every host needs this loop, but each waits for a time its own way: a test moves a manual clock,
 * the CLI sleeps. So the loop is a generator that yields each time to wait until; the caller waits
 * however it does, then resumes it, and every instance due by then is woken. The loop, and the
 * case of an instance nothing can wake, live here once.
 */

import type { Advanced, InstanceState } from './instance-state.ts';

/** How driving an instance ended: finished, panicked, or `stuck` waiting on nothing a timer wakes. */
export type Settled =
  | Exclude<InstanceState, { kind: 'waiting' | 'ready' }>
  | { readonly kind: 'stuck' };

/**
 * Yields each time the group of instances started by `first`'s advance waits until, calling `wake`
 * for every instance that is due once the caller resumes; returns how each settled, `first`'s
 * first and the others in the order they were spawned.
 */
export function* settle(
  wake: (instance: string) => Advanced,
  first: { readonly instance: string; readonly advanced: Advanced },
): Generator<bigint, ReadonlyMap<string, Settled>, void> {
  const states = new Map<string, InstanceState>();
  const record = (instance: string, { state, spawned }: Advanced) => {
    states.set(instance, state);
    for (const child of spawned) {
      if (!states.has(child)) {
        states.set(child, { kind: 'ready' });
      }
    }
  };
  record(first.instance, first.advanced);
  for (;;) {
    for (let ready = readyIn(states); ready !== undefined; ready = readyIn(states)) {
      record(ready, wake(ready));
    }
    const due = earliestTimer(states);
    if (due === undefined) {
      return new Map([...states].map(([instance, state]) => [instance, settledOf(state)]));
    }
    yield due;
    for (const [instance, state] of states) {
      if (state.kind === 'waiting' && state.until !== undefined && state.until <= due) {
        record(instance, wake(instance));
      }
    }
  }
}

/** An instance of the group that is ready to run now. */
function readyIn(states: ReadonlyMap<string, InstanceState>): string | undefined {
  return [...states].find(([, state]) => state.kind === 'ready')?.[0];
}

/** The earliest time an instance of the group waits until; undefined when none waits on a timer. */
function earliestTimer(states: ReadonlyMap<string, InstanceState>): bigint | undefined {
  let earliest: bigint | undefined;
  for (const state of states.values()) {
    if (state.kind === 'waiting' && state.until !== undefined) {
      earliest = earliest === undefined || state.until < earliest ? state.until : earliest;
    }
  }
  return earliest;
}

/** How an instance that nothing will wake again ended. */
function settledOf(state: InstanceState): Settled {
  return state.kind === 'waiting' || state.kind === 'ready' ? { kind: 'stuck' } : state;
}
