/**
 * A runtime under test (host/index.ts): time that moves only when the test says so, a store that
 * keeps every commit it was asked to write, and a fixed seed, so a run repeats.
 *
 * - A test starts a program's live `main` from its encoded Definition, as a host does, and reads how
 *   it ended: an outcome as the JSON text its start encoded (§9), as a host reads it.
 * - A run, or an instance the store keeps, that waits on nothing that can wake it fails the test:
 *   no host is left to wake it.
 */

import type { EncodedDefinition } from '../definition/definition.ts';
import { stdNatives } from '../stdlib/natives.ts';
import type { HostExterns } from './boundary/host-natives.ts';
import { ManualClock } from './clock.ts';
import { createRuntime, type Runtime } from './host/index.ts';
import type { DeployedProgram, HostReports } from './host/programs.ts';
import type { InstanceState, StartOptions } from './instance-state.ts';
import type { FullNativeContext, Natives } from './natives.ts';
import { seedBytes } from './random-draws.ts';
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
    writeDefinition: (hash, bytes) => {
      definitions.push(hash);
      inner.writeDefinition(hash, bytes);
    },
  };
}

/** The seed of every instance a test runtime starts, so its random values repeat (§3.8). */
export const testSeed = new Uint8Array(seedBytes);

interface TestRuntimeOptions {
  readonly natives?: Natives;
  readonly store?: RecordingStore;
  readonly clock?: ManualClock;
  readonly host?: HostExterns;
  readonly seed?: () => Uint8Array;
  /** Told what the contexts a live run drives report by themselves. */
  readonly reports?: HostReports;
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
  reports,
}: TestRuntimeOptions = {}): TestRuntime {
  const inner = createRuntime({
    natives,
    store,
    clock,
    seed,
    host,
    ...(reports === undefined ? {} : { reports }),
  });
  const starters = new Map<string, DeployedProgram>();
  const deploy: Runtime['deploy'] = (encoded) => {
    const program = inner.deploy(encoded);
    return {
      ...program,
      start: async (instance, request) => {
        starters.set(instance, program);
        return await program.start(instance, request);
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

/** How an instance nothing will wake again ended, an outcome read as its JSON text. */
type Ended =
  | Exclude<InstanceState, { kind: 'waiting' | 'ready' | 'finished' }>
  | { readonly kind: 'finished'; readonly outcome: string };

/** How `instance`, in `state`, which nothing will wake again, ended. */
function endedOf(test: TestRuntime, instance: string, state: InstanceState): Ended {
  if (state.kind === 'waiting' || state.kind === 'ready') {
    throw new Error(`Instance ${instance} waits on nothing that can wake it.`);
  }
  if (state.kind !== 'finished') {
    return state;
  }
  return { kind: 'finished', outcome: test.programOf(instance).outcomeText(state) };
}

/**
 * Deploys `encoded` and starts its live `main` under the name `instance`, a run that drives its
 * contexts itself and has ended once its start returns; how it ended.
 */
export async function startToEnd(
  test: TestRuntime,
  encoded: EncodedDefinition,
  { instance = 'test', ...options }: StartOptions & { readonly instance?: string } = {},
): Promise<Ended> {
  const { state } = await test.runtime.deploy(encoded).start(instance, options);
  return endedOf(test, instance, state);
}

/** A context for natives that never use theirs; touching it is a bug in the test. */
export const unusedContext: FullNativeContext = new Proxy({} as FullNativeContext, {
  get: (_target, property) => {
    throw new Error(`The native read its context's ${String(property)}.`);
  },
});
