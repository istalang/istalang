/**
 * One test's world (§10): a fresh host world over a store in memory (host/durable-world.ts), running
 * the test as a call into a context of its own, named `test` (§9), with every instance it spawns,
 * each committed at every await as any host's are, and answering what the test's code asks of them
 * (`TestingWorld`): their inspection, waits on their idleness or a waypoint, and host handles.
 *
 * - **It ends** when the call into `test` answers, or when any instance panics, which fails the
 *   test at once with that panic, unless another instance awaits that instance's end (`result()`,
 *   as `expectPanic` does), which then hears it as an `Err`: the panics no instance hears are the
 *   ones the world reports to its host.
 * - **Driving.** What can run, runs; then the waits on instances whose condition holds settle,
 *   each checked once everything ready has run and committed; then the world waits for its
 *   earliest timer on the clock it is given, real time unless the test mocked it. A test whose
 *   instances wait on nothing that can wake them fails, naming where each waits; so does one whose
 *   next timer falls past its deadline.
 * - What an instance shows a test (`inspect`, `idle()`, `reaches(label)`) is what it last
 *   committed, as a host reads it (host/instance-calls.ts `inspectionOf`).
 * - Instances it spawned that still wait when it ends are dropped with the world.
 */

import type { EmittedProgram } from '../../codegen/emit.ts';
import type { Definition } from '../../definition/definition.ts';
import type { TypeId } from '../../definition/operands.ts';
import type { Value } from '../../definition/values/values.ts';
import { jobWaypoint } from '../../foundation/language/well-known/jobs.ts';
import type { Clock } from '../clock.ts';
import { DurableWorld } from '../host/durable-world.ts';
import { inspectionOf } from '../host/instance-calls.ts';
import type { Inspection, LogRecord } from '../instance-state.ts';
import type { Natives, TestWatch } from '../natives.ts';
import { Future } from '../run/objects/future.ts';
import type { Run } from '../run/run.ts';
import type { TestingWorld } from '../run/world.ts';
import { memoryStore } from '../store.ts';

/** A failed test: why, where, and the log records its instances wrote, in order (§10). */
export interface Failed {
  readonly kind: 'failed';
  readonly message: string;
  readonly trace: string;
  readonly logs: readonly LogRecord[];
}

/** How a test's call ended: answered with its outcome, or failed. */
export type Ended = { readonly kind: 'finished'; readonly outcome: Value } | Failed;

/** A call a test's world makes into its context: an entry, with its arguments. */
export interface WorldCall {
  readonly function: number;
  readonly arguments: readonly Value[];
}

/** What a world is given: the program, its natives, the clock, the seed and the deadline. */
export interface WorldSeams {
  readonly definition: Definition;
  readonly program: EmittedProgram;
  readonly natives: Natives;
  /** The program's version, its Definition's content hash (§9). */
  readonly version: string;
  readonly clock: Clock;
  /** The seed of the test's random source (§3.8 `random`): its full title's hash. */
  readonly seed: Uint8Array;
  /** When the test must have ended, in milliseconds since the Unix epoch. */
  readonly deadline: bigint;
}

/** The key of the test's own context; the instances it spawns are named after it. */
const testInstance = 'test';

/** Runs `call` in a fresh world's `test` context, until it answers or something fails it. */
export async function runInWorld(seams: WorldSeams, call: WorldCall): Promise<Ended> {
  const { definition, program, natives, version, clock, seed, deadline } = seams;
  const logs: LogRecord[] = [];
  const host = new TestHost();
  let ended: Ended | undefined;
  const failed = (name: string, { message, trace }: { message: string; trace: string }) => {
    const told = name === testInstance ? message : `Instance ${name} panicked: ${message}`;
    ended ??= { kind: 'failed', message: told, trace, logs };
  };
  const tested = { definition, hash: version, emitted: program };
  const world = new DurableWorld(
    {
      natives,
      store: memoryStore(),
      clock,
      seed: () => seed,
      testing: host,
      reports: { logs: (records) => logs.push(...records), panicked: failed },
    },
    () => tested,
  );
  host.world = world;
  const root = world.liveRun(tested, 'host', (record) => logs.push(record));
  const closure: Value = { kind: 'closure', function: call.function, captures: [] };
  world.invokeIn(root, testInstance, { closure, passed: call.arguments }, (end) => {
    if (end.kind === 'returned') {
      ended ??= { kind: 'finished', outcome: end.value };
    } else if (end.kind === 'panicked') {
      failed(testInstance, end);
    }
  });
  const done = () => ended !== undefined;
  for (;;) {
    world.drain(done);
    if (ended !== undefined) {
      return ended;
    }
    if (!host.settleWatches()) {
      const timer = world.nextTimer();
      if (timer === undefined || timer > deadline) {
        const why =
          timer === undefined
            ? 'The test waits on nothing that can wake it'
            : 'The test waits past its timeout';
        return stuck(world, why, logs);
      }
      // biome-ignore lint/performance/noAwaitInLoops: the world waits for its earliest timer.
      await clock.until(timer);
      world.fireDue(clock.now());
    }
  }
}

/** A wait of a test's code on another instance (§10 `idle()`, `reaches(label)`). */
interface Watch {
  readonly watcher: Run;
  readonly future: Future;
  readonly name: string;
  readonly until: TestWatch;
}

/** What a test's code asks of the instances of its world. */
class TestHost implements TestingWorld {
  world: DurableWorld | undefined;
  #watches: Watch[] = [];
  #handles = 0;

  readonly inspect = (name: string): Inspection | undefined => {
    const resident = this.world?.residents.get(name);
    return resident === undefined ? undefined : inspectionOf(resident);
  };

  readonly watch = (watcher: Run, name: string, until: TestWatch): Value => {
    const future = new Future(watcher.newId());
    this.#watches.push({ watcher, future, name, until });
    return future as unknown as Value;
  };

  readonly handle = (type: TypeId): Value => {
    this.#handles += 1;
    return { kind: 'extern', type, payload: `testing.handle/${String(this.#handles)}` };
  };

  /** Settles every wait whose condition holds; whether any did. */
  settleWatches(): boolean {
    const holding = this.#watches.filter((watch) => this.#holds(watch));
    this.#watches = this.#watches.filter((watch) => !holding.includes(watch));
    for (const { watcher, future } of holding) {
      watcher.arrive(future, (run, watched) => run.settle(watched, null));
    }
    return holding.length > 0;
  }

  /** Whether `watch`'s instance is idle, or waits at its waypoint. */
  #holds({ name, until }: Watch): boolean {
    const inspection = this.inspect(name);
    if (inspection === undefined) {
      return false;
    }
    const { state, waitingAt } = inspection;
    if (until.kind === 'idle') {
      return state.kind === 'finished' || state.kind === 'waiting';
    }
    return state.kind === 'waiting' && waitingAt.some(({ waypoint }) => waypoint === until.label);
  }
}

/**
 * A test stuck for `why`, naming where each instance waits; one waiting on a job is told no runtime
 * serves jobs in a test, so the test mocks the ista function delegating it (§10).
 */
function stuck(world: DurableWorld, why: string, logs: readonly LogRecord[]): Failed {
  const waits = [...world.residents.values()].flatMap((resident) =>
    inspectionOf(resident).waitingAt.map((wait) => ({ instance: resident.name, ...wait })),
  );
  const listed = waits.map(({ instance, waypoint, location }) =>
    waypoint === undefined
      ? `${instance} at ${location}`
      : `${instance} at ${waypoint} (${location})`,
  );
  const onJob = waits.some(({ waypoint }) => waypoint === jobWaypoint)
    ? ' A job runtime.delegate queued waits for a runtime to serve it, which a test has none of: mock the ista function delegating it.'
    : '';
  return { kind: 'failed', message: `${why}: ${listed.join(', ')}.${onJob}`, trace: '', logs };
}
