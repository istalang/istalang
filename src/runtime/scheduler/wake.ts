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
 *   commits. A second run that ends, spawns or logs differently panics the instance, so
 *   extern calls that aren't idempotent, and code that differs between runs, show. Instances it
 *   spawns run with the option too.
 * - A panic commits nothing (§3.12): the instance stays at its last commit, marked panicked, with
 *   when the failed segment started, so a retry sees the same time. One `runtime.isolate` started
 *   is then terminated at once, as an operator would (§9). Its log records are lost with it, as a
 *   discarded run's are: only a commit reports a segment's logs (§3.8 `log`).
 * - A segment also starts by resolving the watches whose condition holds: another instance's end,
 *   read from its last commit in the store (instance-ends.ts), and under a test (§10) a test's own
 *   waits, which only the test world can tell. Under a test, an advance may also start by
 *   answering another instance's call to one of this instance's mocks. The answers a segment
 *   gives are, like its spawns, effects of its commit, which the advance reports for the world to
 *   deliver; it ends at that commit, so the answers arrive, and the instances they wake run,
 *   before this instance runs on.
 * - Where the instance stands afterwards is read from the last commit (`stateOf`), the one place
 *   a host's view of an instance comes from.
 */

import { encodeJson } from '../../definition/codec.ts';
import type { Value } from '../../definition/values.ts';
import type { Advanced, InstanceState, LogRecord, SpawnOptions } from '../instance-state.ts';
import type { HeapObject, Watch } from '../snapshot/objects.ts';
import {
  type InstanceCall,
  type PanickedSnapshot,
  type Replay,
  type Snapshot,
  snapshotFormat,
} from '../snapshot/snapshot.ts';
import type { InstanceStore } from '../store.ts';
import type { Answered } from './futures.ts';
import { Instance } from './instance/index.ts';
import { storedEnds } from './instance-ends.ts';
import type { LoadedDefinition } from './loaded-definition.ts';
import { arriving } from './mocks.ts';
import { endInstance, runSegment, type SegmentEnd } from './segment/index.ts';
import type { CallerFuture, MockCall } from './test-world.ts';

export interface SchedulerSeams {
  readonly store: InstanceStore;
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
}

/** How a new instance begins: the options it keeps for life, and its random source's seed. */
export interface Beginning extends SpawnOptions {
  readonly seed: string;
}

/** The snapshot of a new instance named `name` of `loaded`, about to run `call` (§9). */
export function unstarted(
  loaded: LoadedDefinition,
  name: string,
  call: InstanceCall,
  { crashEveryAwait = false, terminatesOnPanic = false, seed, encoder }: Beginning,
): Snapshot {
  return {
    definition: loaded.hash,
    instance: name,
    status: { kind: 'unstarted', call },
    crashEveryAwait,
    terminatesOnPanic,
    ...(encoder !== undefined && { encoder }),
    spawned: 0,
    random: { seed, draws: 0 },
    pinned: [],
    objects: [],
    ready: [],
  };
}

/** What an advance's first segment begins with before timers and watches. */
type FirstStep =
  | { readonly kind: 'none' }
  | Exclude<Replay, { readonly kind: 'call' }>
  | { readonly kind: 'answer'; readonly call: MockCall }
  | { readonly kind: 'withdraw'; readonly withdrawn: readonly CallerFuture[] };

/**
 * What an advance does before its first segment: fill a future, answer a call to a mock or drop
 * the answers to calls whose callers let go of their futures (§10), or start at a given time.
 */
export type AdvanceFirst = FirstStep & {
  /** When the first segment counts as started, for a retry of one that panicked (§3.12, §5). */
  readonly startedAt?: bigint;
};

const noneFirst: FirstStep = { kind: 'none' };

/** What an advance did, and the answers its segments gave other instances' calls (§10). */
export interface Advance extends Advanced {
  readonly answered: readonly Answered[];
}

/**
 * Advances an instance of `loaded` from `snapshot` as far as it goes without waiting. The future
 * `first.arrival` names is filled in its first segment, which runs whoever waits on it and commits
 * the filled future even when nobody does; a panic there keeps the arrival with the panic, so a
 * retry fills it again.
 */
export function advance(
  seams: SchedulerSeams,
  loaded: LoadedDefinition,
  snapshot: Snapshot,
  first: AdvanceFirst = noneFirst,
): Advance {
  let committed = snapshot;
  let pending: AdvanceFirst = first;
  const spawned: string[] = [];
  const logs: LogRecord[] = [];
  const answered: Answered[] = [];
  const advanced = (state: InstanceState): Advance => ({ state, spawned, logs, answered });
  const ends = storedEnds(seams.store, loaded.definition.types);
  const running: Running = {
    loaded,
    watched: ({ instance, until }) =>
      until.kind === 'ended' ? ends(instance, until.result) : loaded.world.watched(instance, until),
  };
  for (;;) {
    const { startedAt = seams.now(), ...step } = pending;
    pending = noneFirst;
    const run = runFrom(running, committed, startedAt, step);
    if (run === undefined) {
      return advanced(stateOf(committed));
    }
    const { instance, end } = run.instance.crashEveryAwait
      ? rerun(run, runFrom(running, committed, startedAt, step))
      : run;
    if (end.kind === 'panicked') {
      const replay = replayOf(committed.status, step);
      const status = { ...end, segmentStartedAt: startedAt, ...(replay && { replay }) };
      const frozen = commit(seams.store, { ...committed, status });
      if (!frozen.terminatesOnPanic) {
        return advanced(stateOf(frozen));
      }
      const ended = terminate(seams, loaded, { ...frozen, status });
      spawned.push(...ended.spawned);
      logs.push(...ended.logs);
      return advanced(ended.state);
    }
    spawned.push(...commitChildren(seams.store, instance));
    committed = commit(seams.store, instance.snapshot(statusOf(end), objectsOf(end)));
    logs.push(...instance.logs());
    const given = instance.answered();
    answered.push(...given);
    if (end.kind === 'finished' || given.length > 0) {
      return advanced(stateOf(committed));
    }
  }
}

/**
 * Ends a panicked instance of `loaded` as terminated (§3.12), keeping its panic: from its last
 * commit, every execution stops where it waits and everything it held is disposed, a disposal's
 * code run as code (§7).
 */
export function terminate(
  seams: SchedulerSeams,
  loaded: LoadedDefinition,
  snapshot: PanickedSnapshot,
): Advanced {
  const instance = Instance.restore(loaded, snapshot);
  endInstance(instance, seams.now());
  const spawned = commitChildren(seams.store, instance);
  const { message, trace } = snapshot.status;
  const ended = commit(seams.store, instance.snapshot({ kind: 'terminated', message, trace }, []));
  return { state: stateOf(ended), spawned, logs: instance.logs() };
}

/** What a retry runs again after a segment from `status`, starting with `step`, panicked. */
function replayOf(status: Snapshot['status'], step: FirstStep): Replay | undefined {
  if (status.kind === 'unstarted') {
    return { kind: 'call', call: status.call };
  }
  return step.kind === 'arrival' ? step : undefined;
}

/** One segment's run: the instance as it left it, and how it ended. */
interface SegmentRun {
  readonly instance: Instance;
  readonly end: SegmentEnd;
}

/** What every segment of an advance runs: the program, and what tells which watches hold. */
interface Running {
  readonly loaded: LoadedDefinition;
  readonly watched: (watch: Watch) => Value | undefined;
}

/**
 * Runs one segment from `committed`: the future `arrival` names filled first, or the answer to
 * `answering` started first, once the answers that would fill `withdrawn` are dropped, and every
 * watch that holds resolved. Undefined when nothing can run and nothing arrived or resolved, or
 * when `arrival` names no future the instance waits on: one it disposed, whose later fill changes
 * nothing (§7), or one it never had.
 */
function runFrom(
  { loaded, watched }: Running,
  committed: Snapshot,
  startedAt: bigint,
  step: FirstStep,
): SegmentRun | undefined {
  if (committed.status.kind === 'unstarted') {
    const instance = Instance.start(loaded, committed);
    const root = instance.root();
    const first = root === undefined ? undefined : ({ kind: 'driver', execution: root } as const);
    return { instance, end: runSegment(instance, startedAt, first) };
  }
  const instance = Instance.restore(loaded, committed);
  if (
    step.kind === 'arrival' &&
    !instance.futures.resolveHost(step.arrival.token, arriving(instance, step.arrival.value))
  ) {
    return undefined;
  }
  if (step.kind === 'withdraw') {
    instance.futures.withdraw(step.withdrawn);
  }
  instance.futures.resolveDueTimers(startedAt);
  // A resolved watch commits even when nothing waits on it, so a host stops waking its instance.
  const watchResolved = instance.futures.resolveWatches(watched);
  if (instance.idle && !watchResolved && step.kind === 'none') {
    return undefined;
  }
  const first = step.kind === 'answer' ? ({ kind: 'answer', call: step.call } as const) : undefined;
  return { instance, end: runSegment(instance, startedAt, first) };
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

/**
 * What a run left, as text: the snapshot it would commit, what it spawned and what it logged, or
 * its panic.
 */
function runText({ instance, end }: SegmentRun): string {
  if (end.kind === 'panicked') {
    return `panic: ${end.message}`;
  }
  return [
    ...[instance.snapshot(statusOf(end), objectsOf(end)), ...childrenOf(instance)].map(
      (snapshot) => snapshotFormat.write(snapshot).text,
    ),
    encodeJson(instance.logs()),
  ].join('\n');
}

/**
 * Writes the instances `instance`'s segment spawned; their names. A child the store has already,
 * from a run that crashed before its parent committed, is kept once it has started; one still
 * unstarted is written again only when this run spawned a different call, since it never ran and
 * the run that commits decides what it calls.
 */
function commitChildren(store: InstanceStore, instance: Instance): readonly string[] {
  return childrenOf(instance).map((child) => {
    const stored = store.readSnapshot(child.instance);
    const stale =
      stored !== undefined &&
      stored !== snapshotFormat.write(child).text &&
      snapshotFormat.read(stored).status.kind === 'unstarted';
    if (stored === undefined || stale) {
      commit(store, child);
    }
    return child.instance;
  });
}

/** The instances `instance`'s segment spawned, as their `unstarted` snapshots, in spawn order. */
function childrenOf(instance: Instance): readonly Snapshot[] {
  return instance
    .spawns()
    .map(({ name, call, ...beginning }) => unstarted(instance.loaded, name, call, beginning));
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
      return { kind: 'waiting', until: nextTimerOf(snapshot), watching: watchedOf(snapshot) };
    case 'finished':
      return status;
    case 'panicked':
      return { kind: 'panicked', message: status.message, trace: status.trace };
    case 'terminated':
      return status;
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

/** The instances whose end `snapshot`'s instance waits for (§9), each once. */
function watchedOf(snapshot: Snapshot): readonly string[] {
  const watched = snapshot.objects.flatMap((object) =>
    object.kind === 'future' && object.state.kind === 'watch' && object.state.until.kind === 'ended'
      ? [object.state.instance]
      : [],
  );
  return [...new Set(watched)];
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
