/**
 * The world of a host runtime (§5, §9): its live runs and its ista instances, each instance
 * resident in memory while it runs and committed to the store at the end of every segment, so a
 * runtime opened over the same store goes on where it committed.
 *
 * - **Segments.** An instance's segment starts with what wakes it (a call into it, its spawn, a due
 *   timer, another instance's end) and runs until it has nothing ready; then it commits. Its clock
 *   reads the time the segment started, and what it does to others (answering a call, ending, and
 *   the instances it spawned) and its log records leave it only at that commit (§5).
 * - **Commits** write the segment and let out what it did (commits.ts).
 * - **Crossings.** What crosses between runs is copied, and arrives in the receiving run as a turn
 *   of its own, on the object it concerns (world.ts).
 * - **Order.** Residents run in the order their waiting turns arrived across every run, so what
 *   settles first runs first, whichever instance waits on it (§6).
 */

import { hexToBytes } from '@noble/hashes/utils.js';
import { copied } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Clock } from '../clock.ts';
import type { LogRecord, StartOptions } from '../instance-state.ts';
import type { ContextCall, Natives } from '../natives.ts';
import { seedBytes } from '../random-draws.ts';
import {
  Instance,
  type InstanceEnd,
  type InvocationEnd,
  instanceEnding,
} from '../run/instances.ts';
import type { HeldMock } from '../run/mock-answers.ts';
import type { Future } from '../run/objects/future.ts';
import { Run } from '../run/run.ts';
import type { Spawning, TestingWorld, World } from '../run/world.ts';
import { snapshotFormat } from '../snapshot/format.ts';
import { restore } from '../snapshot/restore.ts';
import type { InstanceStore } from '../store.ts';
import { atCommit, type CommitSeams, commit, commitTerminated } from './commits.ts';
import { OpenRuntimes } from './open-runtimes.ts';
import type { HostReports } from './programs.ts';
import {
  type CallInto,
  invoking,
  Resident,
  type ResidentMade,
  type WorldProgram,
} from './resident.ts';

export interface WorldSeams {
  readonly natives: Natives;
  readonly store: InstanceStore;
  readonly clock: Clock;
  readonly seed: () => Uint8Array;
  readonly reports?: HostReports;
  /** What a test's code asks of the world, when the world runs a test (§10). */
  readonly testing?: TestingWorld;
}

export class DurableWorld implements World {
  readonly seams: WorldSeams;
  readonly residents = new Map<string, Resident>();
  readonly testing?: TestingWorld;
  /** The live runs a host's starts are running now, the program each runs and its options. */
  readonly #live = new Map<Run, WorldProgram>();
  readonly #options = new Map<Run, StartOptions>();
  readonly #bind: (hash: string) => WorldProgram;
  /** What waits on the end of an instance spawned but not yet made, its parent's segment uncommitted. */
  readonly #awaitingSpawn = new Map<string, ((end: InstanceEnd) => void)[]>();
  readonly #commits: CommitSeams;
  readonly #runtimes = new OpenRuntimes();

  constructor(seams: WorldSeams, bind: (hash: string) => WorldProgram) {
    this.seams = seams;
    this.#bind = bind;
    if (seams.testing !== undefined) {
      this.testing = seams.testing;
    }
    this.#commits = {
      store: seams.store,
      reports: seams.reports,
      freshRun: (resident) => this.#readBack(resident),
    };
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
      child.terminatesOnPanic = options.terminatesOnPanic === true;
      child.unstarted = true;
      owner?.spawned.push(name);
      child.feed(child.starting(sent), this.seams.clock.now(), { kind: 'start', call: sent });
    };
    if (owner === undefined) {
      started();
    } else {
      owner.effects.push(started);
    }
    return name;
  };

  readonly call = (caller: Run, { key, call, maker }: ContextCall, future: Future): void => {
    const into = { closure: call, passed: [], hears: maker === 'program' };
    this.invokeIn(caller, key, into, (end) =>
      caller.arrivals.arrive(future, (run, answered) => run.settle(answered, instanceEnding(end))),
    );
  };

  /** Makes `into` in the context `key` (§9); `answer` is told how it ended as the context commits. */
  invokeIn(caller: Run, key: string, into: CallInto, answer: (end: InvocationEnd) => void): void {
    const crashEveryAwait = this.#options.get(caller)?.crashEveryAwait ?? false;
    const program = this.#programOf(caller);
    const context =
      this.residents.get(key) ??
      this.load(key) ??
      this.#made({ name: key, program, seed: this.seams.seed() }, crashEveryAwait);
    const sent = { ...into, closure: copied(into.closure), passed: into.passed.map(copied) };
    const answered = (end: InvocationEnd) => {
      if (end.kind === 'returned') {
        const crossed = { ...end, value: copied(end.value) };
        context.effects.push(() => answer(crossed));
      } else {
        context.endings.push(() => answer(end));
      }
    };
    const replay = { kind: 'invocation', call: sent.closure, passed: sent.passed } as const;
    context.feed(invoking(sent, answered), this.seams.clock.now(), replay);
  }

  readonly heldMock = (caller: Run, index: number): HeldMock | undefined => {
    for (let name = parentOf(caller.instance.name); name !== undefined; name = parentOf(name)) {
      const holder = this.residents.get(name)?.run;
      const mock = holder?.mocking.held.of(index);
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
      watcher.arrivals.arrive(future, (run, watching) => run.endWatches.ended(watching, crossed));
    };
    const ended = watched?.end;
    if (ended !== undefined) {
      told(ended);
    } else if (watched === undefined) {
      this.#awaitingSpawn.set(name, [...(this.#awaitingSpawn.get(name) ?? []), told]);
    } else {
      watched.endWatchers.push(told);
    }
  };

  readonly open = (opener: Run): number =>
    this.#runtimes.open(this.#programOf(opener).hash, () => this.#resume());

  readonly close = (runtime: number): void => this.#runtimes.close(runtime);

  readonly served = (waiter: Run, runtime: number, known: number, future: Future): void =>
    this.#runtimes.served(waiter, { runtime, known, future });

  /** The instance `name`, read from the store, or undefined when the store lacks it. */
  load(name: string): Resident | undefined {
    const text = this.seams.store.readSnapshot(name);
    if (text === undefined) {
      return undefined;
    }
    const snapshot = snapshotFormat.read(text);
    const program = this.#bind(snapshot.definition);
    const seed = hexToBytes(snapshot.seed);
    const made = { name, program, seed, status: snapshot.status };
    const resident = this.#made(made, snapshot.crashEveryAwait);
    resident.text = text;
    resident.encoder = snapshot.encoder;
    resident.terminatesOnPanic = snapshot.terminatesOnPanic;
    restore(resident.run, snapshot);
    return resident;
  }

  /**
   * Has the work persisted in the store begin, as the first runtime opens (open-runtimes.ts): every
   * instance running already, and every one the store keeps that hasn't ended, read back.
   */
  #resume(): void {
    for (const resident of this.residents.values()) {
      if (!resident.ended) {
        this.#runtimes.began(resident.name, resident.program.hash);
      }
    }
    for (const name of this.seams.store.instances()) {
      const text = this.residents.has(name) ? undefined : this.seams.store.readSnapshot(name);
      if (text !== undefined && snapshotFormat.read(text).status.kind === 'active') {
        this.load(name);
      }
    }
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

  /** The earliest timer any run waits on. */
  nextTimer(): bigint | undefined {
    let earliest: bigint | undefined;
    for (const run of this.runs) {
      const next = run.timers.next();
      if (next !== undefined && (earliest === undefined || next < earliest)) {
        earliest = next;
      }
    }
    return earliest;
  }

  /** Fires every run's due timers: a live run's at once, a resident's as a segment of its own. */
  fireDue(now: bigint): void {
    for (const run of this.#live.keys()) {
      run.fireDue(now);
    }
    for (const resident of this.residents.values()) {
      resident.wake(now);
    }
  }

  get awaitsHost(): boolean {
    return [...this.#live.keys()].some((run) => run.arrivals.awaitsHost);
  }

  arrival(): Promise<void> {
    return Promise.race([...this.#live.keys()].map((run) => run.arrivals.arrival()));
  }

  /**
   * Runs `resident`'s segment until it has nothing ready or one of its calls parks, then commits it,
   * as every await commits (§6); whether it ran any.
   */
  #advanced(resident: Resident): boolean {
    const { run } = resident;
    if (!run.executions.parkedSinceCommit && resident.inputs.length === 0 && !run.idle) {
      resident.startedAt = this.seams.clock.now();
      resident.inputs.push(() => undefined);
    }
    const took = run.takeArrivals(undefined, true);
    const ran = run.drain(undefined, true);
    if (resident.inputs.length > 0 && !took && !ran && atCommit(run)) {
      commit(resident, this.#commits);
      const { status } = resident;
      if (status.kind === 'panicked' && resident.terminatesOnPanic) {
        this.terminate(resident, { message: status.message, trace: status.trace });
      }
      return true;
    }
    return took || ran;
  }

  /**
   * `resident`, panicked, running again from where it stood before its failed segment (§3.12): a
   * life of its own, since its panic ended the loop serving its jobs.
   */
  restart(resident: Resident): void {
    this.#restored(resident);
    this.#runtimes.began(resident.name, resident.program.hash);
  }

  /** `resident`, panicked, as it stood before its failed segment. */
  #restored(resident: Resident): void {
    const snapshot = snapshotFormat.read(resident.text ?? '');
    resident.run = this.#readBack(resident);
    restore(resident.run, snapshot);
    resident.status = { kind: 'active' };
    resident.inputs = [];
  }

  /**
   * Ends `resident`, panicked, as terminated (§3.12): what it held as it stood before its failed
   * segment is disposed (§7), and it commits holding nothing.
   */
  terminate(resident: Resident, panic: { readonly message: string; readonly trace: string }): void {
    this.#restored(resident);
    resident.startedAt = this.seams.clock.now();
    const { run } = resident;
    run.finish([]);
    commitTerminated(resident, panic, this.#commits);
  }

  /** A resident `made`, which begins a life if it runs (open-runtimes.ts). */
  #made(made: ResidentMade, crashEveryAwait: boolean): Resident {
    const resident = new Resident(made, crashEveryAwait, (each) => this.#runOf(each));
    this.residents.set(made.name, resident);
    if (!resident.ended) {
      this.#runtimes.began(made.name, made.program.hash);
    }
    return resident;
  }

  /**
   * A fresh run of `resident` that its snapshot is read back into: of the program bound to its
   * Definition's hash, as an instance loaded from the store is.
   */
  #readBack(resident: Resident): Run {
    return this.#runOf(resident, this.#bind(resident.program.hash));
  }

  /** A fresh run of `resident` over `program`, its clock reading its segment's start, its logs kept. */
  #runOf(resident: Resident, program = resident.program): Run {
    const { name } = resident;
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
    return (
      this.#residentOfRun(run)?.program ??
      this.#live.get(run) ??
      unreachable(`The run of ${run.instance.name} belongs to no world.`)
    );
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
    const at = resident.run.arrivals.first;
    const firstAt = first?.run.arrivals.first;
    if (first === undefined || (at !== undefined && (firstAt === undefined || at < firstAt))) {
      first = resident;
    }
  }
  return first;
}
