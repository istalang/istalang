/**
 * A live run (proposal 8, Rule 7): an entry started outside any instance, run in memory to its end.
 * It never commits and never reaches the store, so a restart ends it and nothing of it is retried.
 *
 * - It runs on an instance made from its `unstarted` snapshot, kept only in memory: a segment runs
 *   every ready execution, on past every wait, until none is ready (segment/, `runLiveSegment`).
 * - Its waits ride the host's own event loop, as JavaScript's do: the run adds no loop of its own.
 *   With nothing ready, it awaits whichever comes first, its earliest timer on the host's clock or
 *   a resume, called when a host's promise it waits on settles (waiting.ts). It then applies what
 *   resumed it, resolves the timers due and runs again, from the time the clock reads then.
 * - A manual clock jumps to the earliest timer at once, so a test fires a live timer as it does an
 *   instance's, with no real time passing.
 * - It ends when its root returns, with its outcome, encoded as an instance's is (§9), or when it
 *   panics, a promise it waits on rejecting included: as a restart would end it, nothing is
 *   disposed or retried. With nothing ready, no timer and no resume to come, nothing can wake it,
 *   so it ends waiting on nothing. What it logged reaches its host at its end.
 */

import type { Clock } from '../clock.ts';
import type { Advanced, InstanceState } from '../instance-state.ts';
import type { Snapshot } from '../snapshot/snapshot.ts';
import { Instance } from './instance/index.ts';
import type { LoadedDefinition } from './loaded-definition.ts';
import { type LiveSegmentEnd, runLiveSegment } from './segment/index.ts';
import { panicOf } from './segment/limits.ts';
import { LiveResumes } from './waiting.ts';

/** Runs the new instance `snapshot` describes, of `loaded`, as a live run on `clock` to its end. */
export async function runLive(
  clock: Clock,
  loaded: LoadedDefinition,
  snapshot: Snapshot,
): Promise<Advanced> {
  const instance = Instance.start(loaded, snapshot);
  const resumes = new LiveResumes();
  const ended = (state: InstanceState): Advanced => ({ state, spawned: [], logs: instance.logs() });
  let end = runLiveSegment(instance, clock.now(), resumes, instance.root());
  while (end.kind === 'idle') {
    const due = instance.futures.nextTimer();
    if (due === undefined && !resumes.pending) {
      return ended({ kind: 'waiting', until: undefined, watching: [] });
    }
    // biome-ignore lint/performance/noAwaitInLoops: each wait follows the segment before it.
    await woken(clock, due, resumes);
    end = resumed(instance, resumes, clock.now());
  }
  return ended(end);
}

/** Settles once `due` comes on `clock`, or a resume is called, whichever is first. */
async function woken(clock: Clock, due: bigint | undefined, resumes: LiveResumes): Promise<void> {
  const raced = new AbortController();
  await Promise.race([
    ...(resumes.pending ? [resumes.called()] : []),
    ...(due === undefined ? [] : [clock.until(due, raced.signal)]),
  ]);
  raced.abort();
}

/**
 * Runs `instance` on at `now`, once the resumes called are applied and the timers due resolved; a
 * resume panicking, as a promise rejecting does, panics the run.
 */
function resumed(instance: Instance, resumes: LiveResumes, now: bigint): LiveSegmentEnd {
  try {
    resumes.apply();
  } catch (error) {
    const panic = panicOf(error);
    if (panic === undefined) {
      throw error;
    }
    return { kind: 'panicked', message: panic.message, trace: '' };
  }
  instance.futures.resolveDueTimers(now);
  return runLiveSegment(instance, now, resumes);
}
