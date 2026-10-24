/**
 * Advancing an instance (spec §5): segment after segment, each committed before the next runs,
 * until the instance waits, finishes or panics.
 *
 * - A segment starts by resolving the timers due at its start time, which is also what `now()`
 *   returns inside it. It runs from the last committed snapshot, restored, so every segment starts
 *   from exactly what a restart would see.
 * - A commit writes the snapshot through the store and only then goes on (§5). With nothing ready
 *   and no timer due, nothing changed since the last commit, so nothing is written.
 * - With `crashEveryAwait` (§10), every segment runs, is discarded and runs again from the same
 *   snapshot and start time before the second run commits. A second run that ends differently
 *   panics the instance, so extern calls that aren't idempotent, and code that differs between
 *   runs, show.
 * - A panic commits nothing (§3.12): the instance stays at its last commit, marked panicked, with
 *   when the failed segment started, so a retry sees the same time.
 */

import type { InstanceState } from '../instance-state.ts';
import { type Snapshot, snapshotFormat } from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';
import { Instance, type LoadedDefinition } from './instance.ts';
import { runSegment, type SegmentEnd } from './segment.ts';

export interface SchedulerSeams {
  readonly store: InstanceStore;
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
  readonly crashEveryAwait: boolean;
}

/** Where advancing starts: a new instance about to run `main`, or a committed snapshot. */
export type Start =
  | { readonly kind: 'new'; readonly name: string }
  | { readonly kind: 'committed'; readonly snapshot: Snapshot };

/** Advances an instance of `loaded` from `start` as far as it goes without waiting. */
export function advance(
  seams: SchedulerSeams,
  loaded: LoadedDefinition,
  start: Start,
): InstanceState {
  let committed = start.kind === 'committed' ? start.snapshot : undefined;
  const name = start.kind === 'committed' ? start.snapshot.instance : start.name;
  for (;;) {
    const startedAt = seams.now();
    const first = runFrom(loaded, name, committed, startedAt);
    if (first === undefined) {
      return stateOf(committed);
    }
    const { instance, end } = seams.crashEveryAwait
      ? rerun(first, runFrom(loaded, name, committed, startedAt))
      : first;
    if (end.kind === 'panicked') {
      const status = { ...end, segmentStartedAt: startedAt };
      commit(seams.store, { ...(committed ?? emptySnapshot(loaded.hash, name)), status });
      return end;
    }
    committed = commit(seams.store, instance.snapshot(statusOf(end)));
    if (end.kind === 'finished') {
      return end;
    }
  }
}

/** One segment's run: the instance as it left it, and how it ended. */
interface SegmentRun {
  readonly instance: Instance;
  readonly end: SegmentEnd;
}

/** Runs one segment from `committed`, or from `main` for a new instance; undefined when nothing can run. */
function runFrom(
  loaded: LoadedDefinition,
  name: string,
  committed: Snapshot | undefined,
  startedAt: bigint,
): SegmentRun | undefined {
  if (committed === undefined) {
    const { main } = loaded.definition;
    if (main === undefined) {
      throw new Error('This Definition has no main.');
    }
    const instance = Instance.start(loaded, name, main);
    return { instance, end: runSegment(instance, startedAt, instance.root()) };
  }
  const instance = Instance.restore(loaded, committed);
  instance.resolveDueTimers(startedAt);
  if (instance.idle) {
    return undefined;
  }
  return { instance, end: runSegment(instance, startedAt) };
}

/** The re-run of a segment, or a panic when it ended differently from the first run (§10). */
function rerun(first: SegmentRun, second: SegmentRun | undefined): SegmentRun {
  if (second !== undefined && runText(second) === runText(first)) {
    return second;
  }
  const message = 'This segment ran differently when crashEveryAwait re-ran it.';
  const trace = second?.end.kind === 'panicked' ? second.end.trace : '';
  return { instance: first.instance, end: { kind: 'panicked', message, trace } };
}

/** What a run left, as text: the snapshot it would commit, or its panic. */
function runText({ instance, end }: SegmentRun): string {
  return end.kind === 'panicked'
    ? `panic: ${end.message}`
    : snapshotFormat.write(instance.snapshot(statusOf(end))).text;
}

/** Writes `snapshot` through the store; the snapshot as it reads back, which the next segment restores. */
function commit(store: InstanceStore, snapshot: Snapshot): Snapshot {
  const { text } = snapshotFormat.write(snapshot);
  store.writeSnapshot(snapshot.instance, text);
  return snapshotFormat.read(text);
}

function statusOf(
  end: Exclude<SegmentEnd, { kind: 'panicked' }>,
): Exclude<Snapshot['status'], { kind: 'panicked' }> {
  return end.kind === 'finished' ? { kind: 'finished', outcome: end.value } : { kind: 'active' };
}

/** What a panicked instance that never committed is left as: its name, on its Definition. */
function emptySnapshot(definition: string, instance: string): Snapshot {
  return {
    definition,
    instance,
    status: { kind: 'active' },
    externReads: [],
    objects: [],
    ready: [],
  };
}

/** What a committed snapshot says about its instance. */
export function stateOf(snapshot: Snapshot | undefined): InstanceState {
  const status = snapshot?.status ?? { kind: 'active' };
  switch (status.kind) {
    case 'active':
      return { kind: 'waiting', until: snapshot === undefined ? undefined : nextTimerOf(snapshot) };
    case 'finished':
      return { kind: 'finished', value: status.outcome };
    case 'panicked':
      return { kind: 'panicked', message: status.message, trace: status.trace };
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

function nextTimerOf(snapshot: Snapshot): bigint | undefined {
  return snapshot.objects.reduce<bigint | undefined>(
    (earliest, object) =>
      object.kind === 'future' &&
      object.state.kind === 'timer' &&
      (earliest === undefined || object.state.at < earliest)
        ? object.state.at
        : earliest,
    undefined,
  );
}
