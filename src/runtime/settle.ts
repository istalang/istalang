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
 * ends: nothing can wake the group any more. A test's world runs a loop of its own, which also
 * delivers answers, resolves watches and ends at a panic or a deadline (runtime/testing/world/);
 * what both ask of the group is instance-group.ts's.
 */

import { InstanceGroup } from './instance-group.ts';
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
 * order they were spawned. Every advance, `first`'s included, is shown to `seen` as it is recorded,
 * so a host reads what advances report, such as their log records, in one place.
 */
export function* settle(
  wake: (instance: string) => Advanced,
  first: { readonly instance: string; readonly advanced: Advanced },
  seen: (advanced: Advanced) => void = () => undefined,
): Generator<bigint | undefined, ReadonlyMap<string, Settled>, readonly Arrived[] | undefined> {
  const group = new InstanceGroup();
  const record = (instance: string, advanced: Advanced) => {
    seen(advanced);
    group.record(instance, advanced);
  };
  record(first.instance, first.advanced);
  for (;;) {
    for (let ready = group.ready(); ready !== undefined; ready = group.ready()) {
      record(ready, wake(ready));
    }
    if (!group.waits()) {
      return settledAll(group.states);
    }
    const due = group.earliestTimer();
    const arrived = (yield due) ?? [];
    for (const { instance, advanced } of arrived) {
      record(instance, advanced);
    }
    if (due === undefined && arrived.length === 0) {
      return settledAll(group.states);
    }
    for (const instance of group.dueBy(due)) {
      record(instance, wake(instance));
    }
  }
}

/** How each instance of the group ended, with nothing left to wake it. */
function settledAll(states: ReadonlyMap<string, InstanceState>): ReadonlyMap<string, Settled> {
  return new Map([...states].map(([instance, state]) => [instance, settledOf(state)]));
}

/** How an instance that nothing will wake again ended. */
function settledOf(state: InstanceState): Settled {
  return state.kind === 'waiting' || state.kind === 'ready' ? { kind: 'stuck' } : state;
}
