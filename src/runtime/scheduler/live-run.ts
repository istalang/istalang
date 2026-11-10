/**
 * A live run (proposal 8, Rule 7): an entry started outside any instance, run in memory to its end.
 * It never commits and never reaches the store, so a restart ends it and nothing of it is retried.
 *
 * - It runs on an instance made from its `unstarted` snapshot, kept only in memory, segment after
 *   segment as an instance does (wake.ts), but with no commit between them: after each, what nothing
 *   holds any more is let go of, as a commit would leave it out, and the timers due by the clock
 *   are resolved. Its code reads the clock for `now()`.
 * - Its waits ride the host's own event loop, as JavaScript's do: the run adds no loop of its own.
 *   With nothing ready, it awaits whichever comes first, its earliest timer on the host's clock or
 *   a resume, called when a host's promise it waits on settles (waiting.ts), and applies what
 *   resumed it. A promise that has settled already resumes before the clock is waited on, so a
 *   manual clock, which jumps to whatever it is waited until, never jumps past it; with none, a
 *   test's manual clock fires a live timer at once, as it does an instance's.
 * - It ends when its root returns, with its outcome, encoded as an instance's is (§9), or when it
 *   panics, a promise it waits on rejecting included, with the trace of where that wait began: as a
 *   restart would end it, nothing is disposed or retried. With nothing ready, no timer and no host
 *   future, nothing can wake it, so it ends waiting on nothing. What it logged reaches its host at
 *   its end.
 */

import type { Clock } from '../clock.ts';
import type { Advanced, InstanceState } from '../instance-state.ts';
import type { Snapshot } from '../snapshot/snapshot.ts';
import { Instance } from './instance/index.ts';
import type { LoadedDefinition } from './loaded-definition.ts';
import { runLiveSegment, startLiveSegment } from './segment/index.ts';
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
  let end = startLiveSegment(instance, clock.now, resumes, instance.root());
  while (end.kind === 'awaited' || end.kind === 'idle') {
    instance.dropUnheld();
    // biome-ignore lint/performance/noAwaitInLoops: each wait follows the segment before it.
    const stopped = end.kind === 'idle' ? await idled(clock, instance, resumes) : undefined;
    if (stopped !== undefined) {
      return ended(stopped);
    }
    instance.futures.resolveDueTimers(clock.now());
    end = runLiveSegment(instance, clock.now, resumes);
  }
  return ended(end);
}

/**
 * With nothing ready in `instance`, waits for what can wake it and applies the resumes called; how
 * the run ends instead: waiting on nothing that can wake it, or a wait that failed.
 */
async function idled(
  clock: Clock,
  instance: Instance,
  resumes: LiveResumes,
): Promise<InstanceState | undefined> {
  const due = instance.futures.nextTimer();
  const awaitsHost = instance.futures.awaitsHost() || resumes.queued;
  if (due === undefined && !awaitsHost) {
    return { kind: 'waiting', until: undefined, watching: [] };
  }
  await woken(clock, due, awaitsHost ? resumes : undefined);
  const failed = resumes.apply();
  return failed === undefined ? undefined : { kind: 'panicked', ...failed };
}

/**
 * Settles once `due` comes on `clock`, or a resume from `resumes` is called, whichever is first.
 * With resumes to come, the clock is waited on only from the event loop's next turn, once every
 * promise settled by now has called its resume.
 */
async function woken(
  clock: Clock,
  due: bigint | undefined,
  resumes: LiveResumes | undefined,
): Promise<void> {
  const raced = new AbortController();
  const waits: Promise<void>[] = [];
  if (resumes !== undefined) {
    waits.push(resumes.called());
  }
  if (due !== undefined) {
    const timer = async () => {
      if (resumes !== undefined) {
        await nextTurn();
      }
      if (!raced.signal.aborted) {
        await clock.until(due, raced.signal);
      }
    };
    waits.push(timer());
  }
  await Promise.race(waits);
  raced.abort();
}

/** Settles in the event loop's next turn, after the callbacks of every promise settled by now. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
