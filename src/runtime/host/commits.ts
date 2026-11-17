/**
 * Committing a resident's segment (§5, §6): its snapshot written to the store, then what it did let
 * out of it.
 *
 * - **A crash at every await** (§10): before committing, the segment runs again on the instance as
 *   it last committed, from the same inputs, and that run commits; the first one's effects never
 *   leave it.
 * - **A panic** commits the instance as it stood before the failed segment, with the panic, the
 *   time the segment started and the call it was starting, if any, so a retry runs the segment
 *   again (§3.12) and a termination disposes what it held then (§7).
 * - **Too deep to persist** (§5): what it would commit panics at the await that commits it.
 * - **Letting out**: its effects on others, its end to what waits on it, and its log records, to
 *   the host advancing it or else the host's reports; a panicked segment's end alone.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import type { InstanceEnd } from '../run/instances.ts';
import type { Run } from '../run/run.ts';
import { type PersistedStatus, type Snapshot, snapshotFormat } from '../snapshot/format.ts';
import { restore } from '../snapshot/restore.ts';
import { snapshotOf, TooDeep } from '../snapshot/write.ts';
import type { InstanceStore } from '../store.ts';
import type { HostReports } from './binding.ts';
import type { Resident } from './resident.ts';
import { parkedAt } from './waiting.ts';

/** What committing needs of the world. */
export interface CommitSeams {
  readonly store: InstanceStore;
  readonly reports: HostReports | undefined;
  /** A fresh run of `resident`, as a rerun starts over from its last commit. */
  readonly freshRun: (resident: Resident) => Run;
}

/** Commits `resident`'s segment: run again first at every crash, then written, then let out. */
export function commit(resident: Resident, seams: CommitSeams): void {
  if (resident.crashEveryAwait) {
    rerun(resident, seams);
  }
  const { startedAt } = resident;
  let snapshot: Snapshot;
  try {
    snapshot = written(resident, statusOf(resident.run.instance.end, startedAt));
  } catch (error) {
    if (!(error instanceof TooDeep)) {
      throw error;
    }
    const trace = tooDeepTrace(resident);
    resident.run.instance.ended({ kind: 'panicked', message: error.message, trace });
    const status: PersistedStatus = {
      kind: 'panicked',
      message: error.message,
      trace,
      segmentStartedAt: startedAt,
    };
    snapshot = written(resident, status);
  }
  try {
    seams.store.writeSnapshot(resident.name, snapshotFormat.write(snapshot));
  } catch (error) {
    // A write the store fails commits nothing: the instance stands as it last committed (§5).
    backToLastCommit(resident, seams);
    throw error;
  }
  resident.inputs = [];
  resident.unstarted = false;
  resident.status = snapshot.status;
  resident.committed = snapshot;
  resident.replay = undefined;
  resident.run.executions.parkedSinceCommit = false;
  resident.answers = new Map(
    resident.run.invocations
      .persisted()
      .map(({ future, invocation }) => [future.object, invocation]),
  );
  letOut(resident, seams.reports);
}

/** Commits `resident`, terminated (§3.12), holding nothing. */
export function commitTerminated(
  resident: Resident,
  panic: { readonly message: string; readonly trace: string },
  seams: CommitSeams,
): void {
  const status: PersistedStatus = { kind: 'terminated', ...panic };
  const snapshot = { ...emptySnapshot(resident), ...header(resident, status) };
  seams.store.writeSnapshot(resident.name, snapshotFormat.write(snapshot));
  resident.status = status;
  resident.committed = snapshot;
  letOut(resident, seams.reports);
}

/** The status an instance commits with, ended as `end` says or still running. */
function statusOf(end: InstanceEnd | undefined, startedAt: bigint): PersistedStatus {
  if (end === undefined) {
    return { kind: 'active' };
  }
  if (end.kind === 'finished') {
    const encoded = end.encoded === undefined ? {} : { encoded: end.encoded };
    return { kind: 'finished', outcome: end.outcome, ...encoded };
  }
  return { kind: 'panicked', message: end.message, trace: end.trace, segmentStartedAt: startedAt };
}

/** Where the await a too-deep commit panics at stands, as a trace. */
function tooDeepTrace(resident: Resident): string {
  const parked = resident.run.executions.lastParked;
  const at = parked === undefined ? undefined : parkedAt(resident.program.definition, parked.frame);
  return at === undefined ? '' : `at ${at.function} (${at.location})`;
}

/** What every snapshot of `resident` states besides its run: its program, status and options. */
function header(resident: Resident, status: PersistedStatus) {
  const { program, crashEveryAwait, encoder, terminatesOnPanic } = resident;
  return {
    definition: program.hash,
    status,
    crashEveryAwait,
    terminatesOnPanic,
    ...(encoder === undefined ? {} : { encoder }),
  };
}

/** The snapshot committing `resident` with `status`: a panicked one as it stood before the segment. */
function written(resident: Resident, status: PersistedStatus): Snapshot {
  if (status.kind !== 'panicked') {
    return snapshotOf(resident.run, header(resident, status));
  }
  const before = resident.committed ?? emptySnapshot(resident);
  // A failed segment keeps the call that started it, which a retry runs again.
  const { replay } = resident;
  const panicked = replay === undefined ? status : { ...status, replay };
  return { ...before, ...header(resident, panicked) };
}

/**
 * What leaves `resident` as it commits: its effects, its end and its log records; of a panicked
 * segment, which never happened (§5), its end alone.
 */
function letOut(resident: Resident, reports: HostReports | undefined): void {
  const { end, status } = resident;
  const failed = status.kind === 'panicked';
  const effects = resident.effects.splice(0);
  const logs = resident.logs.splice(0);
  for (const effect of failed ? [] : effects) {
    effect();
  }
  for (const ending of resident.endings.splice(0)) {
    ending();
  }
  if (end !== undefined) {
    const watchers = resident.endWatchers.splice(0);
    for (const watcher of watchers) {
      watcher(end);
    }
    if (failed && watchers.length === 0 && !resident.run.instance.heard) {
      reports?.panicked(resident.name, status);
    }
  }
  if (!failed && logs.length > 0) {
    (resident.heardBy ?? reports?.logs)?.(logs);
  }
}

/** Runs `resident`'s segment again on the instance as it last committed, from the same inputs. */
function rerun(resident: Resident, seams: CommitSeams): void {
  const { inputs } = resident;
  backToLastCommit(resident, seams);
  for (const input of inputs) {
    input(resident.run);
  }
  // It stops where the first run stopped, at the segment's commit, so the two run the same segment.
  const { run } = resident;
  for (let busy = true; busy && !atCommit(run); ) {
    busy = run.takeArrivals(undefined, true) || run.drain(undefined, true);
  }
}

/**
 * `resident` as it last committed, read back into a fresh run that takes over what arrives from now
 * on: what its segment did never happened, and nothing of it leaves.
 */
function backToLastCommit(resident: Resident, seams: CommitSeams): void {
  resident.inputs = [];
  resident.effects = [];
  resident.logs = [];
  resident.endings = [];
  resident.spawned = [];
  const replaced = resident.run;
  resident.run = seams.freshRun(resident);
  if (resident.committed !== undefined) {
    restore(resident.run, resident.committed, resident.answers);
  }
  replaced.arrivals.succeededBy(resident.run.arrivals);
}

/**
 * Whether `run`'s segment has reached its commit: nothing is ready, or a call parked at an await
 * (§6) and no invocation waits to start, whose answer no snapshot could keep.
 */
export function atCommit(run: Run): boolean {
  return run.idle || (run.executions.parkedSinceCommit && !run.queue.invoking);
}

/** A snapshot of an instance that never committed: nothing in it yet. */
function emptySnapshot({ name, seed }: Resident): Snapshot {
  return {
    definition: '',
    instance: name,
    status: { kind: 'active' },
    serial: 0,
    seed: bytesToHex(seed),
    draws: 0,
    spawned: 0,
    crashEveryAwait: false,
    terminatesOnPanic: false,
    objects: [],
    live: [],
    timers: [],
    watches: [],
    ready: [],
    invocations: [],
    contextConstants: [],
  };
}
