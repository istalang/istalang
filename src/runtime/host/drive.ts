/**
 * Driving a group of instances (§9): run whatever can run, then wait for the earliest timer, wake
 * every instance due by then, and go on until nothing can wake any of them. An instance an advance
 * spawned joins the group, so a program's spawned instances, and theirs, run with it.
 *
 * Every host needs this one loop, but each waits its own way and may run more than the group's own
 * ready instances: a test moves a manual clock, the CLI sleeps and lets its host's promises settle,
 * and a test's world (runtime/testing/world/) also delivers answers, resolves its waits and ends
 * at its test's end or deadline. So the loop is `drive`, and what differs between hosts is what
 * they give it. `settle` is a host's drive of the instances its start or wake gave: what can run
 * is the group's ready instances, and what arrives while it waits is what its host filled
 * (`Runtime.fill`). What every loop asks of the group is instance-group.ts's.
 */

import type { Advanced, InstanceState } from '../instance-state.ts';
import { InstanceGroup } from './instance-group.ts';

/** An instance its host advanced while the group waited, by filling a future it waits on (§9). */
export interface Arrived {
  readonly instance: string;
  readonly advanced: Advanced;
}

/** How driving an instance ended: finished, panicked, or `stuck` waiting on nothing a timer wakes. */
export type Settled =
  | Exclude<InstanceState, { kind: 'waiting' | 'ready' }>
  | { readonly kind: 'stuck' };

/** What driving a group asks of the host whose instances it drives. */
export interface Driving {
  /** Where each driven instance stands, as the host records every advance. */
  readonly group: InstanceGroup;
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
  /** Runs one thing that can run now, recording its advance; whether there was one. */
  readonly runNext: () => Promise<boolean>;
  /** Wakes `instance`, whose timer is due, recording its advance. */
  readonly wake: (instance: string) => Promise<void>;
  /**
   * Waits until `due`, or with none until the host fills a future; whether the host advanced an
   * instance meanwhile, which it recorded.
   */
  readonly wait: (due: bigint | undefined) => Promise<boolean>;
  /** Whether driving ends before the group settles, as a test does at its end. */
  readonly ends?: () => boolean;
  /** The latest time driving waits until. */
  readonly deadline?: bigint;
}

/** Why driving stopped: the group settled, the host ended it, or its next timer is too late. */
export type Driven = 'settled' | 'ended' | 'late';

/** Drives `driving.group` until nothing can wake it, the host ends it, or it waits too long. */
export async function drive(driving: Driving): Promise<Driven> {
  const { runNext, ends = () => false } = driving;
  for (;;) {
    if (ends()) {
      return 'ended';
    }
    // biome-ignore lint/performance/noAwaitInLoops: one thing runs at a time, seeing what the last committed.
    const stopped = (await runNext()) ? undefined : await waitForTimer(driving);
    if (stopped !== undefined) {
      return stopped;
    }
  }
}

/**
 * With nothing to run now, waits for the group's earliest timer and wakes every instance due by
 * then; why driving stops instead, if it does.
 */
async function waitForTimer({
  group,
  now,
  wake,
  wait,
  deadline,
}: Driving): Promise<Driven | undefined> {
  if (!group.waits()) {
    return 'settled';
  }
  const due = group.earliestTimer();
  if (due !== undefined && deadline !== undefined && due > deadline) {
    return 'late';
  }
  if (!(await wait(due)) && due === undefined) {
    return 'settled';
  }
  for (const instance of group.dueBy(now())) {
    // biome-ignore lint/performance/noAwaitInLoops: instances advance one at a time, each from its own last commit.
    await wake(instance);
  }
  return undefined;
}

/** What settling a host's instances asks of it. */
export interface SettleSeams {
  /** Advances `instance` from its last commit, as `Runtime.wake` does. */
  readonly wake: (instance: string) => Promise<Advanced>;
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
  /**
   * Waits until `due`, or with none until the host fills a future; the instances its fills
   * advanced meanwhile.
   */
  readonly wait: (due: bigint | undefined) => Promise<readonly Arrived[]>;
  /** Shown every advance as it is recorded, `first`'s included, as log records are read. */
  readonly seen?: (advanced: Advanced) => void;
}

/**
 * Drives the group of instances started by `first`'s advance until nothing can wake them; how each
 * settled, `first`'s first and the others in the order they were spawned.
 */
export async function settle(
  { wake, now, wait, seen }: SettleSeams,
  first: Arrived,
): Promise<ReadonlyMap<string, Settled>> {
  const group = new InstanceGroup();
  const record = ({ instance, advanced }: Arrived) => {
    seen?.(advanced);
    group.record(instance, advanced);
  };
  const wakeOne = async (instance: string) => {
    record({ instance, advanced: await wake(instance) });
  };
  record(first);
  await drive({
    group,
    now,
    runNext: async () => {
      const ready = group.ready();
      if (ready !== undefined) {
        await wakeOne(ready);
      }
      return ready !== undefined;
    },
    wake: wakeOne,
    wait: async (due) => {
      const arrived = await wait(due);
      for (const each of arrived) {
        record(each);
      }
      return arrived.length > 0;
    },
  });
  return new Map([...group.states].map(([instance, state]) => [instance, settledOf(state)]));
}

/** How an instance that nothing will wake again ended. */
function settledOf(state: InstanceState): Settled {
  return state.kind === 'waiting' || state.kind === 'ready' ? { kind: 'stuck' } : state;
}
