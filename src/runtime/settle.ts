/**
 * Driving instances until they settle (§9): wake each one when it is ready or its next timer is
 * due, until it finishes or panics, or waits on nothing that can wake it. An instance a wake
 * spawned joins the group, so a program's spawned instances, and theirs, run with it.
 *
 * Every host needs this loop, but each waits its own way: a test moves a manual clock, the CLI
 * sleeps and lets its host's promises settle. So the loop is a generator that yields each time the
 * group waits: until its earliest timer, or `undefined` when only its host can wake it. The caller
 * waits however it does, then resumes it with what its host filled meanwhile (`Runtime.fill`),
 * and every instance due by then is woken. Resumed with nothing while no timer waits, the loop
 * ends: nothing can wake the group any more. The loop, and that case, live here once.
 */

import type { Advanced, InstanceState } from './instance-state.ts';

/** An instance its host advanced while the group waited, by filling a future it waits on (§9). */
export interface Arrived {
  readonly instance: string;
  readonly advanced: Advanced;
}

/** How driving an instance ended: finished, panicked, or `stuck` waiting on nothing a timer wakes. */
export type Settled =
  | Exclude<InstanceState, { kind: 'waiting' | 'ready' }>
  | { readonly kind: 'stuck' };

/**
 * Yields each time the group of instances started by `first`'s advance waits, until its earliest
 * timer or undefined, calling `wake` for every instance that is due once the caller resumes it
 * with what arrived meanwhile; returns how each settled, `first`'s first and the others in the
 * order they were spawned.
 */
export function* settle(
  wake: (instance: string) => Advanced,
  first: { readonly instance: string; readonly advanced: Advanced },
): Generator<bigint | undefined, ReadonlyMap<string, Settled>, readonly Arrived[] | undefined> {
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
    if (![...states.values()].some((state) => state.kind === 'waiting')) {
      return settledAll(states);
    }
    const due = earliestTimer(states);
    const arrived = (yield due) ?? [];
    for (const { instance, advanced } of arrived) {
      record(instance, advanced);
    }
    if (due === undefined && arrived.length === 0) {
      return settledAll(states);
    }
    for (const instance of dueBy(states, due)) {
      record(instance, wake(instance));
    }
  }
}

/** The instances of the group whose next timer is due by `due`; none when no time was waited. */
function dueBy(states: ReadonlyMap<string, InstanceState>, due: bigint | undefined): string[] {
  return [...states].flatMap(([instance, state]) =>
    due !== undefined && state.kind === 'waiting' && state.until !== undefined && state.until <= due
      ? [instance]
      : [],
  );
}

/** How each instance of the group ended, with nothing left to wake it. */
function settledAll(states: ReadonlyMap<string, InstanceState>): ReadonlyMap<string, Settled> {
  return new Map([...states].map(([instance, state]) => [instance, settledOf(state)]));
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
