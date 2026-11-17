/**
 * Driving a host's world until what its driver waits for is done (§5, §6), the one loop every
 * driver runs: a host's start (programs.ts) and a test's world (testing/test-world.ts).
 *
 * - What is ready runs first; then whatever else the driver makes progress with (`progressed`, a
 *   test's waits on its instances); then, while the host can still answer, whichever comes first of
 *   its answer and the next timer, else the clock moves to the next timer, and what is due fires.
 * - It stops once nothing is left that could wake the world, or once its next timer falls past the
 *   driver's `deadline`.
 */

import type { DurableWorld } from './durable-world.ts';

/** What a driver adds to the loop: progress of its own, and when it stops waiting on the clock. */
export interface Driving {
  /** Makes what progress the driver can besides the world's; whether it made any. */
  readonly progressed?: () => boolean;
  /** When the world must be done, in milliseconds since the Unix epoch. */
  readonly deadline?: bigint;
}

/** Why driving stopped: done, nothing left to wake the world, or its next timer past the deadline. */
export type Driven = 'done' | 'idle' | 'pastDeadline';

/** Drives `world` until `done`, or until it can't be done as `driving` says. */
export async function runUntil(
  world: DurableWorld,
  done: () => boolean,
  { progressed = () => false, deadline }: Driving = {},
): Promise<Driven> {
  for (;;) {
    world.drain(done);
    if (done()) {
      return 'done';
    }
    if (!progressed()) {
      // biome-ignore lint/performance/noAwaitInLoops: each turn waits on what the last one left.
      const stopped = await waited(world, deadline);
      if (stopped !== undefined) {
        return stopped;
      }
      world.fireDue(world.binding.clock.now(), done);
    }
  }
}

/**
 * Waits for what can wake `world` next: the host's answer or the next timer, whichever comes first,
 * while the host can still answer, else the next timer; why driving stops, if nothing can.
 */
async function waited(
  world: DurableWorld,
  deadline: bigint | undefined,
): Promise<Driven | undefined> {
  const { clock } = world.binding;
  const timer = world.nextTimer();
  if (deadline !== undefined && timer !== undefined && timer > deadline) {
    return 'pastDeadline';
  }
  if (world.awaitsHost) {
    await (timer === undefined
      ? world.arrival()
      : Promise.race([world.arrival(), clock.until(timer)]));
  } else if (timer === undefined) {
    return 'idle';
  } else {
    await clock.until(timer);
  }
  return undefined;
}
