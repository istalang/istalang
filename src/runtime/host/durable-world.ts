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

import { copied } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { withHost } from '../boundary/host-natives.ts';
import type { LogRecord, StartOptions } from '../instance-state.ts';
import type { ContextCall, Natives } from '../natives.ts';
import { instanceSeed, seedBytes } from '../random-draws.ts';
import {
  Instance,
  type InstanceEnd,
  type InvocationEnd,
  instanceEnding,
} from '../run/instances.ts';
import { type HeldMock, heldAbove } from '../run/mock-answers.ts';
import type { RunSeams } from '../run/natives.ts';
import type { Future } from '../run/objects/future.ts';
import { Run } from '../run/run.ts';
import type { Spawning, TestingWorld, World } from '../run/world.ts';
import { type Snapshot, snapshotFormat } from '../snapshot/format.ts';
import { restore } from '../snapshot/restore.ts';
import type { HostBinding } from './binding.ts';
import { atCommit, type CommitSeams, commit, commitTerminated } from './commits.ts';
import { LiveRuns } from './live-runs.ts';
import { OpenRuntimes } from './open-runtimes.ts';
import {
  type CallInto,
  firstArrived,
  invoking,
  Resident,
  type ResidentMade,
  type WorldProgram,
} from './resident.ts';

export class DurableWorld implements World {
  readonly binding: HostBinding;
  readonly residents = new Map<string, Resident>();
  readonly testing?: TestingWorld;
  /** The std's natives, with the host's externs bound to its extern declarations. */
  readonly #natives: Natives;
  readonly #live = new LiveRuns();
  readonly #bind: (hash: string) => WorldProgram;
  /** What waits on the end of an instance spawned but not yet made, its parent's segment uncommitted. */
  readonly #awaitingSpawn = new Map<string, ((end: InstanceEnd) => void)[]>();
  readonly #commits: CommitSeams;
  readonly #runtimes = new OpenRuntimes();

  /**
   * A world bound by `binding`, reading a Definition by its hash through `bind`; `testing` answers
   * what a test's code asks of it, when it runs a test (§10).
   */
  constructor(binding: HostBinding, bind: (hash: string) => WorldProgram, testing?: TestingWorld) {
    this.binding = binding;
    this.#natives = withHost(binding.natives, binding.externs ?? {});
    this.#bind = bind;
    if (testing !== undefined) {
      this.testing = testing;
    }
    this.#commits = {
      store: binding.store,
      reports: binding.reports,
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
    const { clock, seed } = this.binding;
    const instance = new Instance(name, false);
    const run = this.#run(program, { instance, clock, seed: instanceSeed(seed, name), log });
    this.#live.began(run, { program, options });
    return run;
  }

  /** Lets go of a live run that ended. */
  endLive(run: Run): void {
    this.#live.ended(run);
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
      const lineage = [parent.instance.name, ...parent.instance.lineage];
      const made = { name, program: this.#programOf(parent), seed, lineage, crashEveryAwait };
      const child = this.#made(made);
      child.endWatchers.push(...(this.#awaitingSpawn.get(name) ?? []));
      this.#awaitingSpawn.delete(name);
      child.encoder = encoder;
      child.terminatesOnPanic = options.terminatesOnPanic === true;
      child.unstarted = true;
      owner?.spawned.push(name);
      child.feed(child.starting(sent), this.binding.clock.now(), { kind: 'start', call: sent });
    };
    if (owner === undefined) {
      started();
    } else {
      owner.effects.push(started);
    }
    return name;
  };

  readonly call = (caller: Run, { key, call, maker }: ContextCall, future: Future): void => {
    let heard = maker === 'program';
    // A call let go of unanswered hears no panic, which is then the host's to hear (§9).
    future.cancels.push(() => {
      heard = false;
    });
    const into = { closure: call, passed: [], hears: () => heard };
    this.invokeIn(caller, key, into, (end) =>
      caller.arrivals.arrive(future, (run, answered) => run.settle(answered, instanceEnding(end))),
    );
  };

  /** Makes `into` in the context `key` (§9); `answer` is told how it ended as the context commits. */
  invokeIn(caller: Run, key: string, into: CallInto, answer: (end: InvocationEnd) => void): void {
    // Only a live run calls into a context, the call rule keeping ista code from its natives
    // (proposal 8, Rule 2), which it makes with the run's program and options (§9, §10).
    const { program, options } =
      this.#live.of(caller) ?? unreachable('A context call of no live run.');
    const context =
      this.residents.get(key) ??
      this.load(key) ??
      this.#made({
        name: key,
        program,
        seed: instanceSeed(this.binding.seed, key),
        crashEveryAwait: options.crashEveryAwait ?? false,
      });
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
    context.feed(invoking(sent, answered), this.binding.clock.now(), replay);
  }

  readonly heldMock = (caller: Run, index: number): HeldMock | undefined =>
    heldAbove(caller, index, (name) => this.residents.get(name)?.run);

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

  readonly open = (
    opener: Run,
    opened: Future,
    made: (run: Run, runtime: number) => Value,
  ): void => {
    const program = this.#programOf(opener).hash;
    this.#runtimes.open(program, () => this.#resume(), { opener, opened, made });
  };

  readonly close = (runtime: number): void => this.#runtimes.close(runtime);

  readonly served = (waiter: Run, runtime: number, known: number, future: Future): void =>
    this.#runtimes.served(waiter, { runtime, known, future });

  /** The instance `name`, read from the store, or undefined when the store lacks it. */
  load(name: string): Resident | undefined {
    const snapshot = this.#stored(name);
    return snapshot === undefined ? undefined : this.#loaded(name, snapshot);
  }

  /** The snapshot the store keeps of `name`, if any. */
  #stored(name: string): Snapshot | undefined {
    const text = this.binding.store.readSnapshot(name);
    return text === undefined ? undefined : snapshotFormat.read(text);
  }

  /** The instance `name`, resident again as `snapshot`, the store's of it, says. */
  #loaded(name: string, snapshot: Snapshot): Resident {
    const program = this.#bind(snapshot.definition);
    const resident = this.#made({ name, program, committed: snapshot });
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
    for (const name of this.binding.store.instances()) {
      const snapshot = this.residents.has(name) ? undefined : this.#stored(name);
      if (snapshot?.status.kind === 'active') {
        this.#loaded(name, snapshot);
      }
    }
  }

  /** Every run, live ones first, then each resident's in the order it was made. */
  get runs(): readonly Run[] {
    return [...this.#live.runs, ...[...this.residents.values()].map(({ run }) => run)];
  }

  /**
   * Runs every run's arrivals and ready work until none has any or `done` says the host's run is
   * done, committing each resident whose segment ran, once it has nothing ready; then lets the
   * live runs that opened a runtime go on.
   */
  drain(done: () => boolean = () => false): void {
    for (let busy = true; busy && !done(); ) {
      busy = false;
      for (const run of this.#live.runs) {
        busy = run.takeArrivals(done) || busy;
        busy = run.drain(done) || busy;
      }
      const unvisited = new Set(this.residents.values());
      for (let next = firstArrived(unvisited); next !== undefined; next = firstArrived(unvisited)) {
        unvisited.delete(next);
        busy = this.#advanced(next) || busy;
      }
      busy ||= this.#opened();
    }
  }

  /**
   * Lets the live runs that opened a runtime go on once the work it resumed ran what it had due
   * by now, a timer that came due while none was open included (§9); whether anything moved.
   */
  #opened(): boolean {
    if (!this.#runtimes.opening) {
      return false;
    }
    if (!this.#wokeDue(this.binding.clock.now())) {
      this.#runtimes.letOpenersGoOn();
    }
    return true;
  }

  /**
   * Whether the work persisted in the store runs: while a runtime is open over it (§9), and always
   * in a test's world, which drives its instances itself (§10).
   */
  get #storeWorkRuns(): boolean {
    return this.testing !== undefined || this.#runtimes.anyOpen;
  }

  /** Starts a segment of each resident with a timer due by `now`; whether any had one. */
  #wokeDue(now: bigint): boolean {
    let woke = false;
    for (const resident of this.residents.values()) {
      woke = resident.wake(now) || woke;
    }
    return woke;
  }

  /** The earliest timer any run waits on, a resident's only while the store's work runs. */
  nextTimer(): bigint | undefined {
    let earliest: bigint | undefined;
    const runs = this.#storeWorkRuns ? this.runs : this.#live.runs;
    for (const run of runs) {
      const next = run.timers.next();
      if (next !== undefined && (earliest === undefined || next < earliest)) {
        earliest = next;
      }
    }
    return earliest;
  }

  /**
   * Fires every run's due timers, a resident's as a segment of its own. The residents' go first and
   * run until `done` or nothing is ready, so what a context answers because of them reaches a live
   * run before its own timers due at the same instant decide what waited on both (§6).
   */
  fireDue(now: bigint, done: () => boolean = () => false): void {
    if (this.#storeWorkRuns) {
      this.#wokeDue(now);
    }
    this.drain(done);
    if (done()) {
      return;
    }
    for (const run of this.#live.runs) {
      run.fireDue(now);
    }
  }

  get awaitsHost(): boolean {
    return this.#live.runs.some((run) => run.arrivals.awaitsHost);
  }

  arrival(): Promise<void> {
    return Promise.race(this.#live.runs.map((run) => run.arrivals.arrival()));
  }

  /**
   * Runs `resident`'s segment until it has nothing ready or one of its calls parks, then commits it,
   * as every await commits (§6); whether it ran any.
   */
  #advanced(resident: Resident): boolean {
    const { run } = resident;
    if (!run.executions.parkedSinceCommit && resident.inputs.length === 0 && !run.idle) {
      resident.startedAt = this.binding.clock.now();
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
    const snapshot = resident.committed ?? unreachable('A panicked instance has committed.');
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
    resident.startedAt = this.binding.clock.now();
    const { run } = resident;
    run.lifetimes.disposingPastPanics(() => run.finish([]));
    commitTerminated(resident, panic, this.#commits);
  }

  /** A resident `made`, which begins a life if it runs (open-runtimes.ts). */
  #made(made: ResidentMade): Resident {
    const resident = new Resident(made, (each) => this.#runOf(each));
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
    const run = this.#run(program, {
      instance: new Instance(resident.name, true, resident.lineage),
      clock: { now: () => resident.startedAt, until: this.binding.clock.until },
      seed: resident.seed,
      log: (record) => resident.logs.push(record),
    });
    // What arrives is an input of the segment taking it, which a segment run again applies again.
    run.onArrivalTaken = (input) => resident.inputs.push(input);
    return run;
  }

  /** A run of `program`, as the instance, on the clock, seed and log `made` gives, of this world. */
  #run(program: WorldProgram, made: Pick<RunSeams, 'instance' | 'clock' | 'seed' | 'log'>): Run {
    const seams = { ...made, natives: this.#natives, world: this, version: program.hash };
    return new Run(program.definition, program.emitted, seams);
  }

  #residentOfRun(run: Run): Resident | undefined {
    return run.instance.durable ? this.residents.get(run.instance.name) : undefined;
  }

  #programOf(run: Run): WorldProgram {
    return (
      this.#residentOfRun(run)?.program ??
      this.#live.of(run)?.program ??
      unreachable(`The run of ${run.instance.name} belongs to no world.`)
    );
  }
}
