/**
 * A runtime under test: time that moves only when the test says so, a store that keeps every
 * commit it was asked to write, and running an instance to its end by moving time to each timer.
 */

import { definitionFormat } from '../definition/definition.ts';
import type { Value } from '../definition/values/values.ts';
import { stdNatives } from '../stdlib/natives.ts';
import type { HostExterns } from './boundary/host-natives.ts';
import { ManualClock } from './clock.ts';
import { type Settled, settle } from './host/drive.ts';
import { createRuntime, type DeployedProgram, type Runtime } from './host/index.ts';
import type { Advanced, StartOptions } from './instance-state.ts';
import type { FullNativeContext, Natives } from './natives.ts';
import { Refusal } from './refusal.ts';
import { seedBytes } from './snapshot/random.ts';
import { type InstanceStore, memoryStore } from './store.ts';

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
}

/** A runtime on the std natives, a recording store and a manual clock, unless told otherwise. */
export function testRuntime({
  natives = stdNatives,
  store = recordingStore(),
  clock = new ManualClock(),
  host = {},
  seed = () => testSeed,
}: TestRuntimeOptions = {}): TestRuntime {
  const inner = createRuntime({ natives, store, clock, seed, host });
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
  return {
    runtime: { ...inner, deploy },
    store,
    clock,
    programOf: (instance) => starters.get(instance) ?? inner.programOf(instance),
  };
}

/**
 * Moves time to each timer the instance, or one it spawned, waits for and wakes them, until none
 * waits any more; how each settled, the instance first.
 */
export function settleAll(
  { runtime, clock }: TestRuntime,
  instance: string,
  initial: Advanced,
): Promise<ReadonlyMap<string, Settled>> {
  return settle(
    {
      wake: async (name) => await runtime.wake(name),
      now: clock.now,
      wait: async (due) => {
        if (due !== undefined) {
          await clock.until(due);
        }
        return [];
      },
    },
    { instance, advanced: initial },
  );
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
  const settled = (await settleAll(test, instance, initial)).get(instance);
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

/** Deploys `text`, starts `main` as an instance and runs it to its end. */
export async function startToEnd(
  test: TestRuntime,
  text: string,
  { instance = 'test', ...options }: StartOptions & { readonly instance?: string } = {},
): Promise<Ended> {
  const program: DeployedProgram = test.runtime.deploy(text);
  return await runToEnd(test, instance, await program.start(instance, options));
}

/**
 * The program `text` with its code that waits made live, as compiling it as live code will
 * (proposal 8): the entries named in `entries`, or every one without them.
 */
export function asLive(text: string, entries?: readonly string[]): string {
  const definition = definitionFormat.read(text);
  const functions = definition.functions.map((entry) =>
    entry.kind === 'code' &&
    entry.mode === 'ista' &&
    (entries === undefined || entries.includes(entry.name))
      ? { ...entry, mode: 'live' as const }
      : entry,
  );
  return definitionFormat.write({ ...definition, functions }).text;
}

/** A context for natives that never use theirs; touching it is a bug in the test. */
export const unusedContext: FullNativeContext = new Proxy({} as FullNativeContext, {
  get: (_target, property) => {
    throw new Error(`The native read its context's ${String(property)}.`);
  },
});
