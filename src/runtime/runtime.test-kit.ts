/**
 * A runtime under test: time that moves only when the test says so, a store that keeps every
 * commit it was asked to write, and running an instance to its end by moving time to each timer.
 */

import type { Value } from '../definition/values.ts';
import { stdNatives } from '../stdlib/natives.ts';
import type { HostExterns } from './boundary/host-natives.ts';
import { createRuntime, type DeployedProgram, type Runtime } from './host.ts';
import type { Advanced } from './instance-state.ts';
import type { FullNativeContext, Natives } from './natives.ts';
import { Refusal } from './refusal.ts';
import type { StartOptions } from './scheduler/instance.ts';
import { type Settled, settle } from './settle.ts';
import { type InstanceStore, memoryStore } from './store.ts';

/** A clock that reads `at` until a test moves it. */
export interface ManualClock {
  readonly now: () => bigint;
  readonly set: (at: bigint) => void;
}

export function manualClock(start = 0n): ManualClock {
  let at = start;
  return {
    now: () => at,
    set: (next) => {
      at = next;
    },
  };
}

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
export const testSeed = '0'.repeat(64);

export interface TestRuntimeOptions {
  readonly natives?: Natives;
  readonly store?: RecordingStore;
  readonly clock?: ManualClock;
  readonly host?: HostExterns;
}

export interface TestRuntime {
  readonly runtime: Runtime;
  readonly store: RecordingStore;
  readonly clock: ManualClock;
}

/** A runtime on the std natives, a recording store and a manual clock, unless told otherwise. */
export function testRuntime({
  natives = stdNatives,
  store = recordingStore(),
  clock = manualClock(),
  host = {},
}: TestRuntimeOptions = {}): TestRuntime {
  return {
    runtime: createRuntime({ natives, store, now: clock.now, seed: () => testSeed, host }),
    store,
    clock,
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
): ReadonlyMap<string, Settled> {
  const steps = settle((name) => runtime.wake(name), { instance, advanced: initial });
  let step = steps.next();
  for (; !step.done; step = steps.next([])) {
    if (step.value !== undefined) {
      clock.set(step.value);
    }
  }
  return step.value;
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
export function runToEnd(test: TestRuntime, instance: string, initial: Advanced): Ended {
  const settled = settleAll(test, instance, initial).get(instance);
  if (settled === undefined || settled.kind === 'stuck') {
    throw new Error(`Instance ${instance} waits on nothing that can wake it.`);
  }
  if (settled.kind !== 'finished') {
    return settled;
  }
  try {
    return {
      kind: 'finished',
      outcome: test.runtime.programOf(instance).outcomeText(settled.outcome),
    };
  } catch (error) {
    if (error instanceof Refusal) {
      return settled;
    }
    throw error;
  }
}

/** Deploys `text`, starts `main` as an instance and runs it to its end. */
export function startToEnd(
  test: TestRuntime,
  text: string,
  { instance = 'test', ...options }: StartOptions & { readonly instance?: string } = {},
): Ended {
  const program: DeployedProgram = test.runtime.deploy(text);
  return runToEnd(test, instance, program.start(instance, options));
}

/** A context for natives that never use theirs; touching it is a bug in the test. */
export const unusedContext: FullNativeContext = new Proxy({} as FullNativeContext, {
  get: (_target, property) => {
    throw new Error(`The native read its context's ${String(property)}.`);
  },
});
