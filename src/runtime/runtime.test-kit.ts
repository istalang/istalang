/**
 * A runtime under test: time that moves only when the test says so, a store that keeps every
 * commit it was asked to write, and running an instance to its end by moving time to each timer.
 */

import { stdNatives } from '../stdlib/natives.ts';
import { createRuntime, type DeployedProgram, type Runtime } from './host.ts';
import type { InstanceState } from './instance-state.ts';
import type { NativeContext, Natives } from './natives.ts';
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

/** A memory store that also keeps every snapshot text written, in order. */
export interface RecordingStore extends InstanceStore {
  readonly commits: readonly string[];
}

export function recordingStore(inner: InstanceStore = memoryStore()): RecordingStore {
  const commits: string[] = [];
  return {
    ...inner,
    commits,
    writeSnapshot: (instance, text) => {
      commits.push(text);
      inner.writeSnapshot(instance, text);
    },
  };
}

export interface TestRuntimeOptions {
  readonly natives?: Natives;
  readonly store?: RecordingStore;
  readonly clock?: ManualClock;
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
}: TestRuntimeOptions = {}): TestRuntime {
  return {
    runtime: createRuntime({ natives, store, now: clock.now }),
    store,
    clock,
  };
}

/** Moves time to each timer the instance waits for and wakes it, until it no longer waits. */
export function runToEnd(
  { runtime, clock }: TestRuntime,
  instance: string,
  initial: InstanceState,
): Exclude<Settled, { kind: 'stuck' }> {
  const steps = settle(() => runtime.wake(instance), initial);
  let step = steps.next();
  for (; !step.done; step = steps.next()) {
    clock.set(step.value);
  }
  if (step.value.kind === 'stuck') {
    throw new Error(`Instance ${instance} waits on nothing that can wake it.`);
  }
  return step.value;
}

/** Deploys `text`, starts `main` as an instance and runs it to its end. */
export function startToEnd(
  test: TestRuntime,
  text: string,
  { instance = 'test', ...options }: StartOptions & { readonly instance?: string } = {},
): InstanceState {
  const program: DeployedProgram = test.runtime.deploy(text);
  return runToEnd(test, instance, program.start(instance, options));
}

/** A context for natives that never use theirs; touching it is a bug in the test. */
export const unusedContext: NativeContext = new Proxy({} as NativeContext, {
  get: (_target, property) => {
    throw new Error(`The native read its context's ${String(property)}.`);
  },
});
