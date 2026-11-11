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
 *   a resume, called when a host resolves a future it waits on (waiting.ts). Each segment begins
 *   with one resume applied, as an instance's begins with one arrival, and collects what deciding
 *   its waits let go of before anything runs. A promise that has settled already resumes before
 *   the clock is waited on, so a manual clock, which jumps to whatever it is waited until, never
 *   jumps past it; with none, a test's manual clock fires a live timer at once, as it does an
 *   instance's.
 * - It drives the contexts its runtimes run (§9, run-contexts.ts) in the same loop: between two of
 *   its segments, whatever can run in them runs, their due timers woken, so a call's answer resumes
 *   it as a host's does, and with nothing ready its wait lasts until the earliest timer of either.
 *   They run only while it does, but every call it made starts, its end included.
 * - It ends when its root returns, with its outcome, encoded as an instance's is (§9), or when it
 *   panics, a promise it waits on rejecting included, with the trace of where that wait began: as a
 *   restart would end it, nothing is disposed or retried. With nothing ready, no timer and no host
 *   future but calls into contexts that nothing can wake either, nothing can wake it, so it ends
 *   waiting on nothing. What it logged reaches its host at its end.
 */

import type { Clock } from '../clock.ts';
import type { Advanced, InstanceState } from '../instance-state.ts';
import type { Snapshot } from '../snapshot/snapshot.ts';
import { Instance } from './instance/index.ts';
import type { LoadedDefinition } from './loaded-definition.ts';
import type { RunContexts } from './run-contexts.ts';
import { runLiveSegment, startLiveSegment } from './segment/index.ts';
import { LiveResumes, type LiveWaiting } from './waiting.ts';

/**
 * Runs the new instance `snapshot` describes, of `loaded`, as a live run on `clock` to its end,
 * driving `contexts` (§9).
 */
export async function runLive(
  clock: Clock,
  loaded: LoadedDefinition,
  snapshot: Snapshot,
  contexts: RunContexts,
): Promise<Advanced> {
  const instance = Instance.start(loaded, snapshot);
  const waiting: LiveWaiting = { kind: 'live', resumes: new LiveResumes(), contexts };
  const { resumes } = waiting;
  contexts.runOn(() => resumes.once<undefined>(() => undefined)(undefined));
  try {
    const ended = await runToEnd(clock, instance, waiting);
    await contexts.startCalls();
    return ended;
  } finally {
    contexts.close();
  }
}

/** Runs the live run `instance`, waiting as `waiting` says, to its end. */
async function runToEnd(clock: Clock, instance: Instance, waiting: LiveWaiting): Promise<Advanced> {
  const { resumes } = waiting;
  const ended = (state: InstanceState): Advanced => ({
    state,
    spawned: [],
    logs: instance.effects.logs(),
  });
  let end = startLiveSegment(instance, clock.now, waiting, instance.root());
  while (end.kind === 'awaited' || end.kind === 'idle') {
    instance.dropUnheld();
    // biome-ignore lint/performance/noAwaitInLoops: each wait follows the segment before it.
    const stopped = await (end.kind === 'idle'
      ? idled(clock, instance, waiting)
      : runContexts(clock, waiting.contexts));
    if (stopped !== undefined) {
      return ended(stopped);
    }
    const failed = resumes.applyNext()?.failed;
    if (failed !== undefined) {
      return ended({ kind: 'panicked', ...failed });
    }
    instance.futures.resolveDueTimers(clock.now());
    end = runLiveSegment(instance, clock.now, waiting);
  }
  return ended(end);
}

/**
 * With nothing ready in `instance`, runs what can run in its contexts, then waits for what can
 * wake either, which its next segment applies; how the run ends instead, when nothing can wake it.
 */
async function idled(
  clock: Clock,
  instance: Instance,
  { resumes, contexts }: LiveWaiting,
): Promise<InstanceState | undefined> {
  await contexts.runReady();
  if (resumes.queued) {
    return undefined;
  }
  const due = earliest(instance.futures.nextTimer(), contexts.nextTimer());
  const awaitsHost = instance.futures
    .awaitedFromHost()
    .some((future) => !contexts.awaitsContexts(future));
  if (due === undefined && !awaitsHost) {
    return { kind: 'waiting', until: undefined, watching: [] };
  }
  await woken(clock, due, awaitsHost ? resumes : undefined);
  await contexts.wakeDue(clock.now());
  return undefined;
}

/** Runs what can run in `contexts` between two segments of a run that hasn't waited: never its end. */
async function runContexts(clock: Clock, contexts: RunContexts): Promise<undefined> {
  await contexts.wakeDue(clock.now());
  await contexts.runReady();
  return undefined;
}

/** The earlier of two times, either undefined for none. */
function earliest(first: bigint | undefined, second: bigint | undefined): bigint | undefined {
  if (first === undefined || second === undefined) {
    return first ?? second;
  }
  return first < second ? first : second;
}

/**
 * Settles once `due` comes on `clock` or a resume from `resumes` is called, whichever is first.
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
