/**
 * Driving a group of instances on a test's clock (§10): run whatever can run, then wait for the
 * earliest timer, wake every instance due by then, and go on until nothing can wake any of them. An
 * instance an advance spawned joins the group, so a program's spawned instances, and theirs, run
 * with it.
 *
 * A test's world (index.ts) drives its test this way, also delivering answers, resolving
 * its waits and ending at its test's end or deadline, and a test of the instance engine drives the
 * instances it started directly (runtime.test-kit.ts): so the loop is `drive`, and what differs is
 * what each gives it. What every loop asks of the group is ../../host/instance-group.ts's. A live
 * run drives its contexts itself, inside its own loop (host/contexts.ts).
 */

import type { Clock } from '../../clock.ts';
import type { InstanceGroup } from '../../host/instance-group.ts';

/** What driving a group asks of whoever drives it. */
export interface Driving {
  /** Where each driven instance stands, as every advance is recorded. */
  readonly group: InstanceGroup;
  /** The clock timers fall due on, waited on for the earliest one. */
  readonly clock: Clock;
  /** Runs one thing that can run now, recording its advance; whether there was one. */
  readonly runNext: () => Promise<boolean>;
  /** Wakes `instance`, whose timer is due, recording its advance. */
  readonly wake: (instance: string) => Promise<void>;
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
  clock,
  wake,
  deadline,
}: Driving): Promise<Driven | undefined> {
  const due = group.earliestTimer();
  if (due === undefined) {
    return 'settled';
  }
  if (deadline !== undefined && due > deadline) {
    return 'late';
  }
  await clock.until(due);
  for (const instance of group.dueBy(clock.now())) {
    // biome-ignore lint/performance/noAwaitInLoops: instances advance one at a time, each from its own last commit.
    await wake(instance);
  }
  return undefined;
}
