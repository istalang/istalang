/**
 * A host scenario run on the pipeline (../scenarios.ts): its program deployed as a Definition's
 * text, as every host deploys one, and each step taken through the host API, on the pipeline's
 * manual clock and all-zero seed, over one store a restart keeps.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { type EncodedDefinition, encodeDefinition } from '../../../src/definition/definition.ts';
import { ManualClock } from '../../../src/runtime/clock.ts';
import { createRuntime, type Runtime } from '../../../src/runtime/host/index.ts';
import type { HostReports } from '../../../src/runtime/host/programs.ts';
import type { Advanced, Inspection, InstanceState } from '../../../src/runtime/instance-state.ts';
import { Refusal } from '../../../src/runtime/refusal.ts';
import { type InstanceStore, memoryStore } from '../../../src/runtime/store.ts';
import { stdNatives } from '../../../src/stdlib/natives.ts';
import { logLine, withoutEmpty } from '../observation.ts';
import type { Scenario } from '../scenarios.ts';
import { compiledAt, frameIn, hostOf, recording } from './index.ts';

/** What each step of `scenario` showed, in order (scenarios.ts). */
export async function observeScenario(scenario: Scenario): Promise<readonly unknown[]> {
  const { directory, program: path } = scenario;
  const text = readFileSync(`${directory}${path}`, 'utf8');
  const compiled = compiledAt(directory, path, text);
  if ('problem' in compiled) {
    throw new Error(`${scenario.name}'s program doesn't compile: ${compiled.problem}`);
  }
  const definition = encodeDefinition(compiled.definition);
  const host = recording(await hostOf({ ...scenario, path, text }));
  const heard = hearing(directory);
  const store = memoryStore();
  const clock = new ManualClock();
  const runtimeOver = (): Runtime =>
    createRuntime({
      natives: stdNatives,
      store,
      clock,
      seed: () => new Uint8Array(32),
      host: host.externs,
      reports: heard.reports,
    });
  let runtime = runtimeOver();
  let callsShown = 0;
  const shown: unknown[] = [];
  for (const step of scenario.steps) {
    if ('restart' in step) {
      runtime = runtimeOver();
    }
    // biome-ignore lint/performance/noAwaitInLoops: steps run in order, each on what the last left.
    const taken = await stepOrRefusal({ runtime, store, clock, directory, definition }, step);
    const calls = host.calls.slice(callsShown);
    callsShown = host.calls.length;
    shown.push(withoutEmpty({ ...taken, ...heard.since(), hostCalls: calls }));
  }
  return shown;
}

/** What a scenario's steps run against. */
interface ScenarioWorld {
  readonly runtime: Runtime;
  readonly store: InstanceStore;
  readonly clock: ManualClock;
  readonly directory: string;
  readonly definition: EncodedDefinition;
}

type Step = Scenario['steps'][number];

async function stepOrRefusal(world: ScenarioWorld, step: Step): Promise<Record<string, unknown>> {
  try {
    return await stepShown(world, step);
  } catch (error) {
    if (error instanceof Refusal) {
      return { refused: error.reason };
    }
    throw error;
  }
}

/** Takes `step`, every kind of step but a restart, which replaces the runtime itself. */
async function stepShown(world: ScenarioWorld, step: Step): Promise<Record<string, unknown>> {
  const { runtime } = world;
  const advanced = (instance: string, given: Advanced) => advancedShown(world, instance, given);
  if ('start' in step) {
    const { start, ...request } = step;
    return advanced(start, await runtime.deploy(world.definition).start(start, request as never));
  }
  if ('wake' in step) {
    return advanced(step.wake, await runtime.wake(step.wake));
  }
  if ('retry' in step) {
    return advanced(step.retry, await runtime.retry(step.retry));
  }
  if ('terminate' in step) {
    return advanced(step.terminate, await runtime.terminate(step.terminate));
  }
  if ('inspect' in step) {
    return inspectionShown(world, step.inspect, runtime.inspect(step.inspect));
  }
  if ('stored' in step) {
    return {
      stored: world.store.instances().toSorted((first, second) => first.localeCompare(second)),
    };
  }
  if ('clock' in step) {
    world.clock.set(BigInt(step.clock));
  }
  return {};
}

/** What advancing `instance` gave: its state, the instances it spawned and its log records. */
function advancedShown(
  world: ScenarioWorld,
  instance: string,
  { state, spawned, logs }: Advanced,
): Record<string, unknown> {
  return { ...stateShown(world, instance, state), spawned, logs: logs.map(logLine) };
}

/** What inspecting `instance` read: its state, and where each execution waits. */
function inspectionShown(
  world: ScenarioWorld,
  instance: string,
  { state, waitingAt }: Inspection,
): Record<string, unknown> {
  const relative = pathToFileURL(world.directory).href;
  return {
    ...stateShown(world, instance, state),
    waitingAt: waitingAt.map(({ waypoint, location }) =>
      withoutEmpty({ waypoint, location: location.replace(relative, '') }),
    ),
  };
}

/** `state`, an instance's, as a scenario shows it. */
function stateShown(
  world: ScenarioWorld,
  instance: string,
  state: InstanceState,
): Record<string, unknown> {
  switch (state.kind) {
    case 'finished':
      return { finished: outcomeTextOf(world, instance, state) };
    case 'panicked':
    case 'terminated':
      return { [state.kind]: state.message, frame: frameIn(world.directory, state.trace) };
    case 'waiting':
      return {
        waiting: withoutEmpty({
          ...(state.until === undefined ? {} : { until: Number(state.until) }),
          watching: state.watching,
        }),
      };
    default:
      return { [state.kind]: true };
  }
}

/** A finished instance's outcome as JSON text, or null when no codec writes its type. */
function outcomeTextOf(
  world: ScenarioWorld,
  instance: string,
  state: Extract<InstanceState, { kind: 'finished' }>,
): string | null {
  try {
    const program = state.encoded === undefined ? world.runtime.programOf(instance) : undefined;
    return program === undefined
      ? world.runtime.deploy(world.definition).outcomeText(state)
      : program.outcomeText(state);
  } catch (error) {
    if (error instanceof Refusal) {
      return null;
    }
    throw error;
  }
}

/** What a host hears of instances it didn't advance: log lines and unheard panics. */
function hearing(directory: string) {
  let logs: string[] = [];
  let unheard: unknown[] = [];
  const reports: HostReports = {
    logs: (records) => {
      logs.push(...records.map(logLine));
    },
    panicked: (instance, { message, trace }) => {
      unheard.push({ instance, panicked: message, frame: frameIn(directory, trace) });
    },
  };
  return {
    reports,
    since: () => {
      const heard = { reported: logs, unheard };
      logs = [];
      unheard = [];
      return heard;
    },
  };
}
