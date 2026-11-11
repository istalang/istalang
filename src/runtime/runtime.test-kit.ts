/**
 * A runtime under test: time that moves only when the test says so, a store that keeps every
 * commit it was asked to write, and running an instance to its end by moving time to each timer.
 *
 * A test of the instance engine starts an instance directly (`startInstance`), as a spawn starts
 * one, running a function of the program as its root: no host starts ista code, which runs in
 * contexts (§9), and a context, whose calls answer rather than finish it, never ends the way such a
 * test reads. Nothing encodes its outcome, which is the value its function gave.
 */

import { definitionFormat } from '../definition/definition.ts';
import type { Value } from '../definition/values/values.ts';
import { unreachable } from '../foundation/structures/unreachable.ts';
import { stdNatives } from '../stdlib/natives.ts';
import { type HostExterns, hostNatives } from './boundary/host-natives.ts';
import { ManualClock } from './clock.ts';
import { createRuntime, type Runtime } from './host/index.ts';
import { InstanceGroup } from './host/instance-group.ts';
import type { DeployedProgram } from './host/programs.ts';
import type { Advanced, InstanceState, StartOptions } from './instance-state.ts';
import type { FullNativeContext, Natives } from './natives.ts';
import { Refusal } from './refusal.ts';
import { loadDefinition } from './scheduler/loaded-definition.ts';
import { Resident } from './scheduler/resident.ts';
import { advance, unstarted } from './scheduler/wake.ts';
import { seedBytes, seedTextOf } from './snapshot/random.ts';
import { type InstanceStore, memoryStore } from './store.ts';
import { drive } from './testing/world/drive.ts';

/** A store that also keeps what was written to it, in order: snapshot texts, and Definition hashes. */
export interface RecordingStore extends InstanceStore {
  readonly commits: readonly string[];
  readonly definitions: readonly string[];
}

export function recordingStore(inner: InstanceStore = memoryStore()): RecordingStore {
  const commits: string[] = [];
  const definitions: string[] = [];
  return {
    ...inner,
    commits,
    definitions,
    writeSnapshot: (instance, text) => {
      commits.push(text);
      inner.writeSnapshot(instance, text);
    },
    writeDefinition: (hash, text) => {
      definitions.push(hash);
      inner.writeDefinition(hash, text);
    },
    readExterns: () => inner.readExterns(),
    writeExterns: (text) => {
      inner.writeExterns(text);
    },
  };
}

/** The seed of every instance a test runtime starts, so its random values repeat (§3.8). */
export const testSeed = new Uint8Array(seedBytes);

export interface TestRuntimeOptions {
  readonly natives?: Natives;
  readonly store?: RecordingStore;
  readonly clock?: ManualClock;
  readonly host?: HostExterns;
  readonly seed?: () => Uint8Array;
}

export interface TestRuntime {
  readonly runtime: Runtime;
  readonly store: RecordingStore;
  readonly clock: ManualClock;
  /**
   * The program that started `instance`: the one deployed through `runtime` and started under
   * that name, which a live run, kept by no runtime, needs to read its outcome; else the runtime's.
   */
  readonly programOf: (instance: string) => DeployedProgram;
  /**
   * Deploys `text` and starts the instance `instance` calling the function `request` names,
   * `main._main`, a rewritten `main`'s ista body, by default, as a spawn starts one; its first
   * advance, the instance then the store's for the runtime to wake.
   */
  readonly startInstance: (text: string, instance: string, request?: InstanceRequest) => Advanced;
}

/** The function an instance a test starts calls, by its name, with `arguments`, and its options. */
interface InstanceRequest extends StartOptions {
  readonly function?: string;
  readonly arguments?: readonly Value[];
}

/** A runtime on the std natives, a recording store and a manual clock, unless told otherwise. */
export function testRuntime({
  natives: nativesGiven = stdNatives,
  store = recordingStore(),
  clock = new ManualClock(),
  host = {},
  seed = () => testSeed,
}: TestRuntimeOptions = {}): TestRuntime {
  const inner = createRuntime({ natives: nativesGiven, store, clock, seed, host });
  const starters = new Map<string, DeployedProgram>();
  const deploy: Runtime['deploy'] = (text) => {
    const program = inner.deploy(text);
    return {
      ...program,
      start: async (instance, options) => {
        starters.set(instance, program);
        return await program.start(instance, options);
      },
    };
  };
  const natives = { ...nativesGiven, ...hostNatives(host) };
  return {
    runtime: { ...inner, deploy },
    store,
    clock,
    programOf: (instance) => starters.get(instance) ?? inner.programOf(instance),
    startInstance: (
      text,
      instance,
      { function: name = 'main._main', arguments: given = [], ...options } = {},
    ) => {
      const { hash } = inner.deploy(text);
      const definition = definitionFormat.read(text);
      const loaded = loadDefinition(definition, hash, natives);
      const called = definition.functions.findIndex(
        (entry) => entry.kind === 'code' && entry.name === name,
      );
      if (called < 0) {
        unreachable(`The program has no function '${name}'.`);
      }
      const call = { function: called, captures: [], arguments: [...given] };
      const beginning = { ...options, seed: seedTextOf(seed()) };
      const resident = new Resident(loaded, unstarted(loaded, instance, call, beginning));
      return advance({ store, now: clock.now }, resident);
    },
  };
}

/** How an instance nothing will wake again ended: finished, panicked, or `stuck` waiting. */
export type Settled =
  | Exclude<InstanceState, { kind: 'waiting' | 'ready' }>
  | { readonly kind: 'stuck' };

/**
 * Moves time to each timer the instance, or one it spawned, waits for and wakes them, until none
 * waits any more; how each settled, the instance first and the others in the order they were
 * spawned.
 */
export async function settleAll(
  { runtime, clock }: TestRuntime,
  instance: string,
  initial: Advanced,
): Promise<ReadonlyMap<string, Settled>> {
  const group = new InstanceGroup();
  group.record(instance, initial);
  const wake = async (name: string) => {
    group.record(name, await runtime.wake(name));
  };
  await drive({
    group,
    now: clock.now,
    runNext: async () => {
      const ready = group.ready();
      if (ready !== undefined) {
        await wake(ready);
      }
      return ready !== undefined;
    },
    wake,
    wait: async (due) => {
      if (due !== undefined) {
        await clock.until(due);
      }
      return false;
    },
  });
  return new Map([...group.states].map(([name, state]) => [name, settledOf(state)]));
}

/** How an instance in `state`, which nothing will wake again, ended. */
function settledOf(state: InstanceState): Settled {
  return state.kind === 'waiting' || state.kind === 'ready' ? { kind: 'stuck' } : state;
}

/** How an instance ended, an outcome its start wrapper encoded (§9) read as its JSON text. */
export type Ended =
  | Exclude<Settled, { kind: 'stuck' | 'finished' }>
  | { readonly kind: 'finished'; readonly outcome: Value | string };

/**
 * Runs the instance and what it spawns until none waits any more; how the instance ended. An
 * outcome a host can read, `main`'s or another started instance's, is its JSON text; a spawned
 * instance's is the value its function gave.
 */
export async function runToEnd(
  test: TestRuntime,
  instance: string,
  initial: Advanced,
): Promise<Ended> {
  return endedOf(test, instance, (await settleAll(test, instance, initial)).get(instance));
}

/** How `instance`, `settled`, ended, its outcome read as `runToEnd` reads it. */
function endedOf(test: TestRuntime, instance: string, settled: Settled | undefined): Ended {
  if (settled === undefined || settled.kind === 'stuck') {
    throw new Error(`Instance ${instance} waits on nothing that can wake it.`);
  }
  if (settled.kind !== 'finished') {
    return settled;
  }
  try {
    return {
      kind: 'finished',
      outcome: test.programOf(instance).outcomeText(settled),
    };
  } catch (error) {
    if (error instanceof Refusal) {
      return settled;
    }
    throw error;
  }
}

/**
 * Deploys `text` and starts its live `main` under the name `instance`, a run that drives its
 * contexts itself and has ended once its start returns; how it ended.
 */
export async function startToEnd(
  test: TestRuntime,
  text: string,
  { instance = 'test', ...options }: StartOptions & { readonly instance?: string } = {},
): Promise<Ended> {
  const program: DeployedProgram = test.runtime.deploy(text);
  const { state } = await program.start(instance, options);
  return endedOf(test, instance, settledOf(state));
}

/** A context for natives that never use theirs; touching it is a bug in the test. */
export const unusedContext: FullNativeContext = new Proxy({} as FullNativeContext, {
  get: (_target, property) => {
    throw new Error(`The native read its context's ${String(property)}.`);
  },
});
