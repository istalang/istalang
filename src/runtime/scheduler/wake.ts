/**
 * Advancing an instance (spec §5): segment after segment, each committed before the next runs,
 * until the instance waits, finishes or panics.
 *
 * - An instance advances from a snapshot: a committed one, or a new instance's `unstarted` one,
 *   whose first segment starts its call (§9).
 * - A segment starts by resolving the timers due at its start time, which is also what `now()`
 *   returns inside it. It runs from the last committed snapshot, restored, so every segment starts
 *   from exactly what a restart would see.
 * - A commit writes the snapshot through the store and only then goes on (§5). With nothing ready
 *   and no timer due, nothing changed since the last commit, so nothing is written.
 * - What a segment spawned becomes instances at its commit: each is written as `unstarted`, named
 *   `<parent>/<n>`, before the parent's snapshot. A segment that re-runs after a crash between the
 *   two finds the child there already and doesn't write it again (§9).
 * - With `crashEveryAwait` (§10), an option the instance keeps in its snapshot, every segment
 *   runs, is discarded and runs again from the same snapshot and start time before the second run
 *   commits. A second run that ends differently, or spawns differently, panics the instance, so
 *   extern calls that aren't idempotent, and code that differs between runs, show. Instances it
 *   spawns run with the option too.
 * - A panic commits nothing (§3.12): the instance stays at its last commit, marked panicked, with
 *   when the failed segment started, so a retry sees the same time.
 * - Where the instance stands afterwards is read from the last commit (`stateOf`), the one place
 *   a host's view of an instance comes from.
 */

import type { Advanced, InstanceState } from '../instance-state.ts';
import type { HeapObject } from '../snapshot/objects.ts';
import { type InstanceCall, type Snapshot, snapshotFormat } from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';
import { Instance, type LoadedDefinition, type StartOptions } from './instance.ts';
import { runSegment, type SegmentEnd } from './segment.ts';

export interface SchedulerSeams {
  readonly store: InstanceStore;
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
}

/** The snapshot of a new instance named `name` of `loaded`, about to run `call` (§9). */
export function unstarted(
  loaded: LoadedDefinition,
  name: string,
  call: InstanceCall,
  { crashEveryAwait = false }: StartOptions,
): Snapshot {
  return {
    definition: loaded.hash,
    instance: name,
    status: { kind: 'unstarted', call },
    crashEveryAwait,
    spawned: 0,
    objects: [],
    ready: [],
  };
}

/** Advances an instance of `loaded` from `snapshot` as far as it goes without waiting. */
export function advance(
  seams: SchedulerSeams,
  loaded: LoadedDefinition,
  snapshot: Snapshot,
): Advanced {
  let committed = snapshot;
  const spawned: string[] = [];
  const advanced = (state: InstanceState): Advanced => ({ state, spawned });
  for (;;) {
    const startedAt = seams.now();
    const first = runFrom(loaded, committed, startedAt);
    if (first === undefined) {
      return advanced(stateOf(committed));
    }
    const { instance, end } = first.instance.crashEveryAwait
      ? rerun(first, runFrom(loaded, committed, startedAt))
      : first;
    if (end.kind === 'panicked') {
      const status = { ...end, segmentStartedAt: startedAt };
      const left =
        committed.status.kind === 'unstarted' ? instance.unrun(status) : { ...committed, status };
      return advanced(stateOf(commit(seams.store, left)));
    }
    spawned.push(...commitChildren(seams.store, instance));
    committed = commit(seams.store, instance.snapshot(statusOf(end), objectsOf(end)));
    if (end.kind === 'finished') {
      return advanced(stateOf(committed));
    }
  }
}

/** One segment's run: the instance as it left it, and how it ended. */
interface SegmentRun {
  readonly instance: Instance;
  readonly end: SegmentEnd;
}

/** Runs one segment from `committed`; undefined when nothing can run. */
function runFrom(
  loaded: LoadedDefinition,
  committed: Snapshot,
  startedAt: bigint,
): SegmentRun | undefined {
  if (committed.status.kind === 'unstarted') {
    const instance = Instance.start(loaded, committed);
    return { instance, end: runSegment(instance, startedAt, instance.root()) };
  }
  const instance = Instance.restore(loaded, committed);
  instance.futures.resolveDueTimers(startedAt);
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

/** What a run left, as text: the snapshot it would commit and what it spawned, or its panic. */
function runText({ instance, end }: SegmentRun): string {
  if (end.kind === 'panicked') {
    return `panic: ${end.message}`;
  }
  return [instance.snapshot(statusOf(end), objectsOf(end)), ...childrenOf(instance)]
    .map((snapshot) => snapshotFormat.write(snapshot).text)
    .join('\n');
}

/**
 * Writes the instances `instance`'s segment spawned, each unless the store has it from a run that
 * crashed before its parent committed; their names.
 */
function commitChildren(store: InstanceStore, instance: Instance): readonly string[] {
  return childrenOf(instance).map((child) => {
    if (store.readSnapshot(child.instance) === undefined) {
      commit(store, child);
    }
    return child.instance;
  });
}

/** The instances `instance`'s segment spawned, as their `unstarted` snapshots, in spawn order. */
function childrenOf(instance: Instance): readonly Snapshot[] {
  return instance.spawns().map((call, index) =>
    unstarted(instance.loaded, `${instance.name}/${instance.spawnedBefore + index + 1}`, call, {
      crashEveryAwait: instance.crashEveryAwait,
    }),
  );
}

/** Writes `snapshot` through the store; the snapshot as it reads back, which the next segment restores. */
function commit(store: InstanceStore, snapshot: Snapshot): Snapshot {
  const { text } = snapshotFormat.write(snapshot);
  store.writeSnapshot(snapshot.instance, text);
  return snapshotFormat.read(text);
}

/** What a segment that didn't panic leaves for its commit to persist. */
function objectsOf(end: Exclude<SegmentEnd, { kind: 'panicked' }>): readonly HeapObject[] {
  return end.kind === 'finished' ? [] : end.objects;
}

/** The status a segment that didn't panic leaves its instance in. */
function statusOf(
  end: Exclude<SegmentEnd, { kind: 'panicked' }>,
): Exclude<Snapshot['status'], { kind: 'panicked' | 'unstarted' }> {
  return end.kind === 'finished' ? end : { kind: 'active' };
}

/** What a committed snapshot says about its instance. */
export function stateOf(snapshot: Snapshot): InstanceState {
  const { status } = snapshot;
  switch (status.kind) {
    case 'unstarted':
      return { kind: 'ready' };
    case 'active':
      return { kind: 'waiting', until: nextTimerOf(snapshot) };
    case 'finished':
      return status;
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
