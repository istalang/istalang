/**
 * The world of a host runtime (§5, §9): its live runs and its ista instances, each instance
 * resident in memory while it runs and committed to the store at the end of every segment, so a
 * runtime opened over the same store goes on where it committed.
 *
 * - **Segments.** An instance's segment starts with what wakes it (a call into it, its spawn, a due
 *   timer, another instance's end) and runs until it has nothing ready; then it commits. Its clock
 *   reads the time the segment started, and what it does to others (answering a call, ending, and
 *   the instances it spawned) and its log records leave it only at that commit (§5).
 * - **A crash at every await** (§10): before committing, the segment runs again on the instance as
 *   it last committed, from the same inputs, and that run commits; the first one's effects never
 *   leave it.
 * - **A panic** commits the instance as it stood before the failed segment, with the panic, the
 *   time the segment started and the call it was starting, if any, so a retry runs the segment
 *   again (§3.12) and a termination disposes what it held then (§7).
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Definition } from '../../definition/definition.ts';
import { locationOf } from '../../definition/traces.ts';
import { copied } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import type { EmittedProgram } from '../../codegen/emit.ts';
import type { Clock } from '../clock.ts';
import type { LogRecord, StartOptions } from '../instance-state.ts';
import type { Natives } from '../natives.ts';
import { seedBytes } from '../random-draws.ts';
import type { InstanceStore } from '../store.ts';
import { Instance, type InstanceEnd, type InvocationEnd, instanceEnding } from '../run/instances.ts';
import type { Future } from '../run/objects.ts';
import type { HeldMock } from '../run/mock-answers.ts';
import { type Invocation, Run } from '../run/run.ts';
import type { Spawning, TestingWorld, World } from '../run/world.ts';
import { type PersistedStatus, type Snapshot, snapshotFormat } from '../snapshot/format.ts';
import { restore, rootInvocation } from '../snapshot/restore.ts';
import { snapshotOf, TooDeep } from '../snapshot/write.ts';
import type { HostReports } from './programs.ts';


/** The program a world runs: its Definition, the hash the store keys it by, its emitted code. */
export interface WorldProgram {
  readonly definition: Definition;
  readonly hash: string;
  readonly emitted: EmittedProgram;
}

export interface WorldSeams {
  readonly natives: Natives;
  readonly store: InstanceStore;
  readonly clock: Clock;
  readonly seed: () => Uint8Array;
  readonly reports?: HostReports;
  /** What a test's code asks of the world, when the world runs a test (§10). */
  readonly testing?: TestingWorld;
}

type Input = (run: Run) => void;

/** An ista instance of the world, resident while the world holds it. */
export class Resident {
  readonly name: string;
  readonly program: WorldProgram;
  /** The seed of its random source: a host's for one it starts, a draw of its parent's for one spawned. */
  readonly seed: Uint8Array;
  crashEveryAwait: boolean;
  /** The entry encoding its outcome, a spawned instance's whose type a codec writes (§9). */
  encoder: number | undefined;
  status: PersistedStatus = { kind: 'active' };
  run: Run;
  /** The snapshot it last committed, if it ever did. */
  text: string | undefined;
  /** Whether it was spawned and hasn't run yet. */
  unstarted = false;
  /** What woke its segment, since its last commit, and when the segment started. */
  inputs: Input[] = [];
  /** The call starting it, which a retry of its failed first segment runs again (§3.12). */
  replay: Value | undefined;
  startedAt = 0n;
  /** What leaves it at its next commit: what it did to others, and its log records. */
  effects: (() => void)[] = [];
  logs: LogRecord[] = [];
  /** Where its log records go while a host advances it itself, rather than to the host's reports. */
  heardBy: ((records: readonly LogRecord[]) => void) | undefined;
  /** The answers of the calls into it running as it last committed, by their futures' ids. */
  answers = new Map<number, Invocation>();
  /** What waits on its end, told as it commits one (§9). */
  readonly endWatchers: ((end: InstanceEnd) => void)[] = [];
  /** The instances it spawned in the segment committing next. */
  spawned: string[] = [];

  constructor(
    { name, program, seed }: { readonly name: string; readonly program: WorldProgram; readonly seed: Uint8Array },
    run: Run,
    crashEveryAwait: boolean,
  ) {
    this.name = name;
    this.program = program;
    this.seed = seed;
    this.run = run;
    this.crashEveryAwait = crashEveryAwait;
  }

  /** Whether its instance has ended: finished, panicked or terminated. */
  get ended(): boolean {
    return this.status.kind !== 'active';
  }
}

export class DurableWorld implements World {
  readonly seams: WorldSeams;
  readonly residents = new Map<string, Resident>();
  /** The live runs a host's starts are running now, the program each runs and its options. */
  readonly #live = new Map<Run, WorldProgram>();
  readonly #options = new Map<Run, StartOptions>();
  readonly #bind: (hash: string) => WorldProgram;
  /** What waits on the end of an instance spawned but not yet made, its parent's segment uncommitted. */
  readonly #awaitingSpawn = new Map<string, ((end: InstanceEnd) => void)[]>();

  readonly testing?: TestingWorld;

  constructor(seams: WorldSeams, bind: (hash: string) => WorldProgram) {
    this.seams = seams;
    this.#bind = bind;
    if (seams.testing !== undefined) {
      this.testing = seams.testing;
    }
  }

  /** A live run of `program`, named `name`, which a host's start drives (§9). */
  liveRun(
    program: WorldProgram,
    name: string,
    log: (record: LogRecord) => void,
    options: StartOptions = {},
  ): Run {
    const run = new Run(program.definition, program.emitted, {
      natives: this.seams.natives,
      clock: this.seams.clock,
      seed: this.seams.seed(),
      log,
      instance: new Instance(name, false),
      world: this,
      version: program.hash,
    });
    this.#live.set(run, program);
    this.#options.set(run, options);
    return run;
  }

  /** Lets go of a live run that ended. */
  endLive(run: Run): void {
    this.#live.delete(run);
    this.#options.delete(run);
  }

  readonly spawn = (parent: Run, closure: Value, { options, encoder }: Spawning): string => {
    parent.instance.spawned += 1;
    const name = `${parent.instance.name}/${parent.instance.spawned}`;
    const sent = copied(closure);
    const owner = this.#residentOfRun(parent);
    // Drawn as it spawns, in the parent's segment, so a segment run again spawns it alike (§5).
    const seed = parent.draw().subarray(0, seedBytes);
    const started = () => {
      const crashEveryAwait = options.crashEveryAwait ?? owner?.crashEveryAwait ?? false;
      const child = this.#made({ name, program: this.#programOf(parent), seed }, crashEveryAwait);
      child.endWatchers.push(...(this.#awaitingSpawn.get(name) ?? []));
      this.#awaitingSpawn.delete(name);
      child.encoder = encoder;
      child.unstarted = true;
      child.replay = sent;
      owner?.spawned.push(name);
      this.feed(child, (run) => this.spawned(child, run, copied(sent)));
    };
    if (owner === undefined) {
      started();
    } else {
      owner.effects.push(started);
    }
    return name;
  };

  readonly call = (caller: Run, key: string, closure: Value, future: Future): void => {
    this.invokeIn(caller, key, { closure, passed: [] }, (end) =>
      caller.arrive(future, (run, answered) => run.settle(answered, instanceEnding(end))),
    );
  };

  /**
   * Runs `closure` with `passed` in the context `key` (§9); `answer` is told how it ended as the
   * context commits.
   */
  invokeIn(
    caller: Run,
    key: string,
    { closure, passed }: { readonly closure: Value; readonly passed: readonly Value[] },
    answer: (end: InvocationEnd) => void,
  ): void {
    const crashEveryAwait = this.#options.get(caller)?.crashEveryAwait ?? false;
    const context =
      this.residents.get(key) ??
      this.load(key) ??
      this.#made({ name: key, program: this.#programOf(caller), seed: this.seams.seed() }, crashEveryAwait);
    const sent = copied(closure);
    this.feed(context, (run) =>
      run.invoke(
        copied(sent),
        (end) => {
          const crossed = end.kind === 'returned' ? { ...end, value: copied(end.value) } : end;
          context.effects.push(() => answer(crossed));
        },
        { passed: passed.map(copied) },
      ),
    );
  }

  readonly heldMock = (caller: Run, index: number): HeldMock | undefined => {
    for (let name = parentOf(caller.instance.name); name !== undefined; name = parentOf(name)) {
      const holder = this.residents.get(name)?.run;
      const mock = holder?.mocks.of(index);
      if (holder !== undefined && mock !== undefined) {
        return { holder, mock };
      }
    }
    return undefined;
  };

  readonly watchEnd = (watcher: Run, name: string, future: Future): void => {
    const watched = this.residents.get(name) ?? this.load(name);
    const told = (end: InstanceEnd) => {
      const crossed = end.kind === 'finished' ? { ...end, outcome: copied(end.outcome) } : end;
      watcher.arrive(future, (run, watching) => run.endWatched(watching, crossed));
    };
    const end = watched === undefined ? undefined : endOf(watched.status);
    if (end !== undefined) {
      told(end);
    } else if (watched === undefined) {
      this.#awaitingSpawn.set(name, [...(this.#awaitingSpawn.get(name) ?? []), told]);
    } else {
      watched.endWatchers.push(told);
    }
  };

  /** The instance `name`, read from the store, or undefined when the store lacks it. */
  load(name: string): Resident | undefined {
    const text = this.seams.store.readSnapshot(name);
    if (text === undefined) {
      return undefined;
    }
    const snapshot = snapshotFormat.read(text);
    const resident = this.#made(
      { name, program: this.#bind(snapshot.definition), seed: hexToBytes(snapshot.seed) },
      snapshot.crashEveryAwait,
    );
    resident.text = text;
    resident.encoder = snapshot.encoder;
    this.#restoreInto(resident, snapshot);
    return resident;
  }

  /** Every run, live ones first, then each resident's in the order it was made. */
  get runs(): readonly Run[] {
    return [...this.#live.keys(), ...[...this.residents.values()].map(({ run }) => run)];
  }

  /**
   * Runs every run's arrivals and ready work until none has any or `done` says the host's run is
   * done, committing each resident whose segment ran, once it has nothing ready.
   */
  drain(done: () => boolean = () => false): void {
    for (let busy = true; busy && !done(); ) {
      busy = false;
      for (const run of this.#live.keys()) {
        busy = run.takeArrivals(done) || busy;
        busy = run.drain(done) || busy;
      }
      const unvisited = new Set(this.residents.values());
      for (let next = firstArrived(unvisited); next !== undefined; next = firstArrived(unvisited)) {
        unvisited.delete(next);
        busy = this.#advanced(next) || busy;
      }
    }
  }

  /** Starts a segment of `resident` at the clock's time, firing its due timers; whether any fired. */
  wake(resident: Resident, at = this.seams.clock.now()): void {
    const due = resident.run.nextTimer();
    if (due !== undefined && due <= at) {
      this.feed(resident, (run) => run.fireDue(at), at);
    }
  }

  /** The earliest timer any run waits on. */
  nextTimer(): bigint | undefined {
    const timers = this.runs.flatMap((run) => {
      const next = run.nextTimer();
      return next === undefined ? [] : [next];
    });
    return timers.length === 0 ? undefined : timers.reduce((first, second) => (second < first ? second : first));
  }

  /** Fires every run's due timers: a live run's at once, a resident's as a segment of its own. */
  fireDue(now: bigint): void {
    for (const run of this.#live.keys()) {
      run.fireDue(now);
    }
    for (const resident of this.residents.values()) {
      this.wake(resident, now);
    }
  }

  get awaitsHost(): boolean {
    return [...this.#live.keys()].some((run) => run.awaitsHost);
  }

  arrival(): Promise<void> {
    return Promise.race([...this.#live.keys()].map((run) => run.arrival()));
  }

  /**
   * Runs `resident`'s segment until it has nothing ready or one of its calls parks, then commits it,
   * as every await commits (§6); whether it ran any.
   */
  #advanced(resident: Resident): boolean {
    const { run } = resident;
    if (!run.parkedSinceCommit && resident.inputs.length === 0 && !run.idle) {
      resident.startedAt = this.seams.clock.now();
      resident.inputs.push(() => undefined);
    }
    const took = run.takeArrivals(undefined, true);
    const ran = run.drain(undefined, true);
    const atCommit = run.idle || (run.parkedSinceCommit && !run.invoking);
    if (resident.inputs.length > 0 && !took && !ran && atCommit) {
      this.commit(resident);
      return true;
    }
    return took || ran;
  }

  /** Applies `input` to `resident`, starting its segment if none is going. */
  feed(resident: Resident, input: Input, at = this.seams.clock.now()): void {
    if (resident.inputs.length === 0) {
      resident.startedAt = at;
    }
    resident.inputs.push(input);
    input(resident.run);
  }

  /** Commits `resident`'s segment: run again first at every crash, then written, then let out. */
  commit(resident: Resident): void {
    if (resident.crashEveryAwait) {
      this.#rerun(resident);
    }
    const end = resident.run.instance.end;
    const segment = { inputs: resident.inputs, startedAt: resident.startedAt };
    resident.inputs = [];
    resident.unstarted = false;
    let status: PersistedStatus =
      end === undefined
        ? { kind: 'active' }
        : end.kind === 'finished'
          ? { kind: 'finished', outcome: end.outcome, ...(end.encoded === undefined ? {} : { encoded: end.encoded }) }
          : { kind: 'panicked', message: end.message, trace: end.trace, segmentStartedAt: segment.startedAt };
    let text: string;
    try {
      text = this.#written(resident, status);
    } catch (error) {
      if (!(error instanceof TooDeep)) {
        throw error;
      }
      // What it would commit can't be persisted: it panics at the await that commits (§5).
      const parked = resident.run.lastParked;
      const at = parked === undefined ? undefined : parkedAt(resident.program.definition, parked.frame);
      const trace = at === undefined ? '' : `at ${at.function} (${at.location})`;
      resident.run.instance.ended({ kind: 'panicked', message: error.message, trace });
      status = { kind: 'panicked', message: error.message, trace, segmentStartedAt: segment.startedAt };
      text = this.#written(resident, status);
    }
    resident.status = snapshotFormat.read(text).status;
    resident.text = text;
    resident.run.parkedSinceCommit = false;
    resident.answers = new Map(
      resident.run.persisted().invocations.map(({ future, invocation }) => [future.object, invocation]),
    );
    this.seams.store.writeSnapshot(resident.name, text);
    this.#letOut(resident);
  }

  /** The text committing `resident` with `status`: a panicked one as it stood before the segment. */
  #written(resident: Resident, status: PersistedStatus): string {
    const written = { definition: resident.program.hash, status, crashEveryAwait: resident.crashEveryAwait, ...encoderOf(resident) };
    if (status.kind !== 'panicked') {
      return snapshotFormat.write(snapshotOf(resident.run, written)).text;
    }
    const before = resident.text === undefined ? emptySnapshot(resident) : snapshotFormat.read(resident.text);
    const replay = before.status.kind === 'active' && resident.text !== undefined ? undefined : resident.replay;
    return snapshotFormat.write({ ...before, ...written, status: { ...status, ...(replay === undefined ? {} : { replay }) } as never }).text;
  }

  /** What leaves `resident` as it commits: its effects, its log records and its end. */
  #letOut(resident: Resident): void {
    for (const effect of resident.effects.splice(0)) {
      effect();
    }
    const end = endOf(resident.status);
    if (end !== undefined) {
      const watchers = resident.endWatchers.splice(0);
      for (const watcher of watchers) {
        watcher(end);
      }
      const { status } = resident;
      if (status.kind === 'panicked' && watchers.length === 0 && !resident.run.instance.heard) {
        this.seams.reports?.panicked(resident.name, status);
      }
    }
    const logs = resident.logs.splice(0);
    if (logs.length > 0) {
      (resident.heardBy ?? this.seams.reports?.logs)?.(logs);
    }
  }

  /** Runs `resident`'s segment again on the instance as it last committed, from the same inputs. */
  #rerun(resident: Resident): void {
    const inputs = resident.inputs;
    const { answers } = resident;
    resident.effects = [];
    resident.logs = [];
    resident.spawned = [];
    const replaced = resident.run;
    resident.run = this.#runOf(resident.name, resident);
    if (resident.text !== undefined) {
      restore(resident.run, snapshotFormat.read(resident.text), answers);
    }
    replaced.succeededBy(resident.run);
    for (const input of inputs) {
      input(resident.run);
    }
    // It stops where the first run stopped, at its first park, so the two run the same segment.
    const { run } = resident;
    for (let busy = true; busy && !run.parkedSinceCommit; ) {
      busy = run.takeArrivals(undefined, true) || run.drain(undefined, true);
    }
  }

  #restoreInto(resident: Resident, snapshot: Snapshot, statusToo = true): void {
    restore(resident.run, snapshot);
    if (statusToo) {
      resident.status = snapshot.status;
    }
  }

  /** Starts in `run` the call `resident` was spawned to run: its instance ends with what it gave. */
  spawned(resident: Resident, run: Run, closure: Value): void {
    const { answer } = rootInvocation(run, resident.encoder);
    run.invoke(closure, answer, { root: true });
    resident.replay = closure;
  }

  /** `resident`, panicked, running again from where it stood before its failed segment (§3.12). */
  restart(resident: Resident): void {
    const text = resident.text ?? '';
    const snapshot = snapshotFormat.read(text);
    resident.run = this.#runOf(resident.name, resident);
    restore(resident.run, snapshot);
    resident.status = { kind: 'active' };
    resident.inputs = [];
  }

  /**
   * Ends `resident`, panicked, as terminated (§3.12): what it held as it stood before its failed
   * segment is disposed (§7), and it commits holding nothing.
   */
  terminate(resident: Resident, panic: { readonly message: string; readonly trace: string }): void {
    this.restart(resident);
    resident.startedAt = this.seams.clock.now();
    const { run } = resident;
    run.finish([...run.instance.contextConstants.values()]);
    run.instance.contextConstants.clear();
    resident.status = { kind: 'terminated', ...panic };
    const written = { definition: resident.program.hash, status: resident.status, crashEveryAwait: resident.crashEveryAwait, ...encoderOf(resident) };
    resident.text = snapshotFormat.write({ ...emptySnapshot(resident), ...written }).text;
    this.seams.store.writeSnapshot(resident.name, resident.text);
    this.#letOut(resident);
  }

  #made(
    made: { readonly name: string; readonly program: WorldProgram; readonly seed: Uint8Array },
    crashEveryAwait: boolean,
  ): Resident {
    const resident = new Resident(made, undefined as never, crashEveryAwait);
    resident.run = this.#runOf(made.name, resident);
    this.residents.set(made.name, resident);
    return resident;
  }

  /** A fresh run of the instance `name`, its clock reading its segment's start, its logs kept. */
  #runOf(name: string, resident: Resident): Run {
    const { program } = resident;
    const run = new Run(program.definition, program.emitted, {
      natives: this.seams.natives,
      clock: { now: () => resident.startedAt, until: this.seams.clock.until },
      seed: resident.seed,
      log: (record) => resident.logs.push(record),
      instance: new Instance(name, true),
      world: this,
      version: program.hash,
    });
    // What arrives is an input of the segment taking it, which a segment run again applies again.
    run.onArrivalTaken = (input) => resident.inputs.push(input);
    return run;
  }

  #residentOfRun(run: Run): Resident | undefined {
    return run.instance.durable ? this.residents.get(run.instance.name) : undefined;
  }

  #programOf(run: Run): WorldProgram {
    const program = this.#residentOfRun(run)?.program ?? this.#live.get(run);
    if (program === undefined) {
      throw new Error(`The run of ${run.instance.name} belongs to no world.`);
    }
    return program;
  }
}

/** The instance `name` was spawned from, named before its last `/`; none for one spawned by none. */
function parentOf(name: string): string | undefined {
  const at = name.lastIndexOf('/');
  return at < 0 ? undefined : name.slice(0, at);
}

/**
 * Which of `residents` runs next: the one whose waiting turn arrived first among every run's, so
 * what settles first runs first, whichever instance waits on it (§6); else the first made.
 */
function firstArrived(residents: ReadonlySet<Resident>): Resident | undefined {
  let first: Resident | undefined;
  for (const resident of residents) {
    const at = resident.run.firstArrival;
    const firstAt = first?.run.firstArrival;
    if (first === undefined || (at !== undefined && (firstAt === undefined || at < firstAt))) {
      first = resident;
    }
  }
  return first;
}

/** What a snapshot of `resident` keeps of its outcome's encoder. */
function encoderOf({ encoder }: Resident): { readonly encoder?: number } {
  return encoder === undefined ? {} : { encoder };
}

/** How an instance in `status` ended; undefined while it runs. */
export function endOf(status: PersistedStatus): InstanceEnd | undefined {
  switch (status.kind) {
    case 'finished':
      return { kind: 'finished', outcome: status.outcome, ...(status.encoded === undefined ? {} : { encoded: status.encoded }) };
    case 'panicked':
    case 'terminated':
      return { kind: 'panicked', message: status.message, trace: status.trace };
    default:
      return undefined;
  }
}

/** A snapshot of an instance that never committed: nothing in it yet. */
function emptySnapshot({ name, seed }: Resident): Snapshot {
  return {
    definition: '0'.repeat(64),
    instance: name,
    status: { kind: 'active' },
    serial: 0,
    seed: bytesToHex(seed),
    draws: 0,
    spawned: 0,
    crashEveryAwait: false,
    objects: [],
    live: [],
    timers: [],
    watches: [],
    ready: [],
    invocations: [],
    contextConstants: [],
  };
}

/**
 * Where a frame parked at `pc` waits (§10): its function's name, its waypoint, if the program named
 * one, and the source of its await; undefined when it isn't parked at a `park`.
 */
export function parkedAt(
  definition: Definition,
  { function: index, pc }: { readonly function: number; readonly pc: number },
): { readonly function: string; readonly waypoint: string | undefined; readonly location: string } | undefined {
  const entry = definition.functions[index];
  if (entry?.kind !== 'code') {
    return undefined;
  }
  const park = entry.instructions[pc - entry.instructions.length];
  return park?.kind === 'park'
    ? {
        function: entry.name,
        waypoint: park.waypoint,
        location: locationOf(definition, entry.module, park.span.start),
      }
    : undefined;
}
