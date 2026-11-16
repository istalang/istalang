/**
 * The pipeline the goldens run on, and the one module that knows it: a new pipeline replaces this
 * module and nothing else of the runner (docs/work/ir-first/contracts.md, "Goldens").
 *
 * Today's compiles a program to its Definition, emits it as JavaScript and runs it on the one run
 * (src/runtime), on a manual clock that moves only to the next due timer, from 0, and the
 * all-zero seed, so timers and random values repeat. A program runs its `main` as a host starts
 * it; a scenario's steps drive the host API; a suite runs through `ista test`, which fixes its own
 * clock and seed per test. A host module is loaded afresh for each run, since it may keep state.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';
import { testModules } from '../../src/cli/commands/test.ts';
import { loadHostModule } from '../../src/cli/host-module.ts';
import type { EmittedProgram } from '../../src/codegen/emit.ts';
import { compileProgram, diagnose } from '../../src/compiler/compile.ts';
import { moduleIdOf } from '../../src/compiler/program/program.ts';
import type { Definition } from '../../src/definition/definition.ts';
import { definitionFormat } from '../../src/definition/definition.ts';
import { isError } from '../../src/foundation/diagnostics/diagnostic.ts';
import { tempProject } from '../../src/project/project.test-kit.ts';
import { loadProject } from '../../src/project/project.ts';
import type { HostExterns } from '../../src/runtime/boundary/host-natives.ts';
import { ManualClock } from '../../src/runtime/clock.ts';
import { createRuntime, type Runtime } from '../../src/runtime/host/index.ts';
import type { HostReports } from '../../src/runtime/host/programs.ts';
import type { Advanced, Inspection, InstanceState } from '../../src/runtime/instance-state.ts';
import { type Start, startLive } from '../../src/runtime/program.ts';
import { Refusal } from '../../src/runtime/refusal.ts';
import { type InstanceStore, memoryStore } from '../../src/runtime/store.ts';
import { stdNatives } from '../../src/stdlib/natives.ts';
import {
  hostCallLine,
  innermostOwnFrame,
  logLine,
  type Observation,
  panicEnding,
  withoutEmpty,
} from './observation.ts';
import type { Scenario } from './scenarios.ts';

/**
 * Whether this pipeline implements the spec amendments (docs/work/ir-first/design.md), which the
 * `amended` goldens are written to.
 */
export const runsAmendments = true;

/** A program to run: its module's text, at `path` in `directory`, and its host's module if any. */
export interface ProgramRun {
  readonly directory: string;
  readonly path: string;
  readonly text: string;
  readonly host?: string;
}

/** A suite's project: a directory on disk, or files a temporary project holds while it runs. */
export type SuiteProject =
  | { readonly directory: string }
  | { readonly files: Readonly<Record<string, string>> };

const ending = /\.ista$/u;

/** The Definition of the module `text` at `path` in `directory`, or the first error it reports. */
export function compiledAt(
  directory: string,
  path: string,
  text: string,
): { readonly definition: Definition } | { readonly problem: string } {
  const id = moduleIdOf(pathToFileURL(join(directory, path)));
  const { program } = loadProject(directory, [], {
    buffers: [{ id, name: path.replace(ending, ''), label: path, read: () => text }],
  });
  const compilation = compileProgram(program, id);
  if (compilation.kind === 'compiled') {
    return { definition: compilation.definition };
  }
  const [error] = [...diagnose(program).values()].flatMap(({ diagnostics }) =>
    diagnostics.filter(isError),
  );
  return {
    problem: error === undefined ? compilation.kind : `error ${error.code}: ${error.message}`,
  };
}

/** A host's externs, and the calls they were given, in order, as observation lines. */
export interface RecordingHost {
  readonly externs: HostExterns;
  readonly calls: readonly string[];
}

/** `externs`, recording every call they are given. */
export function recording(externs: HostExterns): RecordingHost {
  const calls: string[] = [];
  return {
    calls,
    externs: Object.fromEntries(
      Object.entries(externs).map(([key, extern]) => [
        key,
        (argumentValues: readonly unknown[], call: Parameters<typeof extern>[1]) => {
          calls.push(hostCallLine(key, argumentValues));
          return extern(argumentValues, call);
        },
      ]),
    ),
  };
}

/** The externs of the host module at `path`, loaded afresh: a module may keep what it served. */
export async function freshHost(path: string): Promise<HostExterns> {
  vi.resetModules();
  const loaded = await loadHostModule(path);
  if (loaded.kind === 'unfit') {
    throw new Error(loaded.problem);
  }
  return loaded.externs;
}

/**
 * A second build of a Definition, which each run read back from a snapshot runs instead of the
 * first (docs/work/ir-first/contracts.md, "Typed-IR gate").
 */
export type ReadBack = (definition: Definition) => EmittedProgram;

/** What running `definition`'s `main` on the run showed, started as `start` says. */
export async function shownByRun(
  definition: Definition,
  host: RecordingHost = recording({}),
  start: Start = {},
  readBack?: ReadBack,
): Promise<Observation> {
  const binding = {
    natives: stdNatives,
    externs: host.externs,
    clock: new ManualClock(),
    seed: new Uint8Array(32),
  };
  const live = readBack === undefined ? {} : { readBack: () => readBack(definition) };
  const { end, logs } = await startLive(definition, binding, start, live);
  const shown = { logs: logs.map(logLine), hostCalls: host.calls };
  switch (end.kind) {
    case 'finished':
      return { ending: { outcome: end.text }, ...shown };
    case 'panicked':
      return { ending: panicEnding(end.message, end.trace), ...shown };
    default:
      return { ending: { unsettled: 'waiting' }, ...shown };
  }
}

/**
 * What running `program` showed, each run read back from a snapshot into `readBack`'s build if
 * given; the first error it reports when it doesn't compile.
 */
export async function observeProgram(
  program: ProgramRun,
  start: Start = {},
  readBack?: ReadBack,
): Promise<Observation | { readonly problem: string }> {
  const compiled = compiledAt(program.directory, program.path, program.text);
  if ('problem' in compiled) {
    return compiled;
  }
  const host = recording(await hostOf(program));
  const observed = await shownByRun(compiled.definition, host, start, readBack);
  const { ending: ended } = observed;
  return 'frame' in ended
    ? { ...observed, ending: { ...ended, frame: relativeFrame(program.directory, ended.frame) } }
    : observed;
}

/**
 * The lines `ista test` prints for the test modules `paths` in `project`, every module under it
 * without any; throws when the run doesn't pass, whose output is no result to record.
 */
export async function observeSuite(
  project: SuiteProject,
  paths: readonly string[],
): Promise<readonly string[]> {
  const directory = 'files' in project ? tempProject(project.files) : project.directory;
  let out = '';
  let err = '';
  const code = await testModules(
    paths,
    { timeout: '5000' },
    {
      cwd: directory,
      write: (text) => {
        out += text;
      },
      writeError: (text) => {
        err += text;
      },
    },
  );
  if (code !== 0 || err !== '') {
    throw new Error(`ista test exited ${String(code)}:\n${out}${err}`);
  }
  return out.trimEnd().split('\n');
}

/** What each step of `scenario` showed, in order (scenarios.ts). */
export async function observeScenario(scenario: Scenario): Promise<readonly unknown[]> {
  const { directory, program: path } = scenario;
  const text = readFileSync(`${directory}${path}`, 'utf8');
  const compiled = compiledAt(directory, path, text);
  if ('problem' in compiled) {
    throw new Error(`${scenario.name}'s program doesn't compile: ${compiled.problem}`);
  }
  const definition = definitionFormat.write(compiled.definition).text;
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
  readonly definition: string;
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

/** `trace`'s innermost frame of the program's own, its file named relative to `directory`. */
function frameIn(directory: string, trace: string): string {
  return relativeFrame(directory, innermostOwnFrame(trace));
}

/** `frame`, a trace's, its file named relative to `directory`. */
function relativeFrame(directory: string, frame: string): string {
  return frame.replace(pathToFileURL(directory).href, '');
}

/** The externs `program`'s host module implements, loaded afresh; none without one. */
async function hostOf({ directory, host }: ProgramRun): Promise<HostExterns> {
  return host === undefined ? {} : await freshHost(`${directory}${host}`);
}
