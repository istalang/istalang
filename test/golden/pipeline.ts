/**
 * The pipeline the goldens run on, and the one module that knows it: a new pipeline replaces this
 * module and nothing else of the runner (docs/work/ir-first/contracts.md, "Goldens").
 *
 * Today's is the interpreter, on a manual clock that moves only to the next due timer, from 0, and
 * the all-zero seed, so timers and random values repeat. A program runs its `main` as a host starts
 * it; a scenario's steps drive the host API; a suite runs through `ista test`, which fixes its own
 * clock and seed per test. A host module is loaded afresh for each run, since it may keep state.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';
import { ista } from '../../src/cli/cli.test-kit.ts';
import { loadHostModule } from '../../src/cli/host-module.ts';
import { compileProgram, diagnose } from '../../src/compiler/compile.ts';
import { moduleIdOf } from '../../src/compiler/program/program.ts';
import { type Definition, definitionFormat } from '../../src/definition/definition.ts';
import { isError } from '../../src/foundation/diagnostics/diagnostic.ts';
import { tempProject } from '../../src/project/project.test-kit.ts';
import { loadProject } from '../../src/project/project.ts';
import type { HostExterns } from '../../src/runtime/boundary/host-natives.ts';
import { ManualClock } from '../../src/runtime/clock.ts';
import type { HostReports } from '../../src/runtime/host/programs.ts';
import type { Advanced, Inspection, InstanceState } from '../../src/runtime/instance-state.ts';
import { Refusal } from '../../src/runtime/refusal.ts';
import { type TestRuntime, testRuntime } from '../../src/runtime/runtime.test-kit.ts';
import {
  hostCallLine,
  innermostOwnFrame,
  logLine,
  type Observation,
  panicEnding,
  withoutEmpty,
} from './observation.ts';
import type { Scenario, Step } from './scenarios.ts';

/**
 * Whether this pipeline implements the spec amendments (docs/work/ir-first/design.md), which the
 * `amended` goldens are written to: the interpreter predates them.
 */
export const runsAmendments = false;

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

/** What running `definition`'s `main` on the interpreter showed. */
export async function shownByInterpreter(
  definition: Definition,
  host: RecordingHost = recording({}),
): Promise<Observation> {
  const { runtime } = testRuntime({ host: host.externs, clock: new ManualClock() });
  const deployed = runtime.deploy(definitionFormat.write(definition).text);
  const { state, logs } = await deployed.start('run');
  const shown = { logs: logs.map(logLine), hostCalls: host.calls };
  switch (state.kind) {
    case 'finished':
      return { ending: { outcome: deployed.outcomeText(state) }, ...shown };
    case 'panicked':
    case 'terminated':
      return { ending: panicEnding(state.message, state.trace), ...shown };
    default:
      return { ending: { unsettled: state.kind }, ...shown };
  }
}

/** What running `program` showed; the first error it reports when it doesn't compile. */
export async function observeProgram(
  program: ProgramRun,
): Promise<Observation | { readonly problem: string }> {
  const compiled = compiledAt(program.directory, program.path, program.text);
  if ('problem' in compiled) {
    return compiled;
  }
  const observed = await shownByInterpreter(compiled.definition, recording(await hostOf(program)));
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
  const run = await ista(directory, 'test', ...paths);
  if (run.code !== 0 || run.err !== '') {
    throw new Error(`ista test exited ${String(run.code)}:\n${run.out}${run.err}`);
  }
  return run.out.trimEnd().split('\n');
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
  const runtimeOver = (given?: TestRuntime): TestRuntime =>
    testRuntime({ host: host.externs, reports: heard.reports, ...given });
  let test = runtimeOver();
  let callsShown = 0;
  const shown: unknown[] = [];
  for (const step of scenario.steps) {
    if ('restart' in step) {
      test = runtimeOver(test);
    }
    // biome-ignore lint/performance/noAwaitInLoops: steps run in order, each on what the last left.
    const taken = await stepOrRefusal(test, { definition, directory }, step);
    const calls = host.calls.slice(callsShown);
    callsShown = host.calls.length;
    shown.push(withoutEmpty({ ...taken, ...heard.since(), hostCalls: calls }));
  }
  return shown;
}

/**
 * What a host hears of the contexts a live run drives, by themselves (§9): their log records, and
 * the panics no call heard, each since it was last asked.
 */
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

/** The program a scenario deploys, as text, and the directory its frames are named relative to. */
interface ScenarioProgram {
  readonly definition: string;
  readonly directory: string;
}

/** What taking `step` on `test`'s runtime showed; the reason when the runtime refuses it. */
async function stepOrRefusal(
  test: TestRuntime,
  program: ScenarioProgram,
  step: Step,
): Promise<Record<string, unknown>> {
  try {
    return await stepShown(test, program, step);
  } catch (error) {
    if (error instanceof Refusal) {
      return { refused: error.reason };
    }
    throw error;
  }
}

/** Takes `step`, every kind of step but a restart, which replaces the runtime itself. */
async function stepShown(
  test: TestRuntime,
  { definition, directory }: ScenarioProgram,
  step: Step,
): Promise<Record<string, unknown>> {
  const { runtime } = test;
  const advanced = (instance: string, given: Advanced) =>
    advancedShown(test, directory, instance, given);
  if ('start' in step) {
    const { start, ...request } = step;
    return advanced(start, await runtime.deploy(definition).start(start, request));
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
    return inspectionShown(test, directory, step.inspect, runtime.inspect(step.inspect));
  }
  if ('stored' in step) {
    return {
      stored: test.store.instances().toSorted((first, second) => first.localeCompare(second)),
    };
  }
  if ('clock' in step) {
    test.clock.set(BigInt(step.clock));
  }
  return {};
}

/** What advancing `instance` gave: its state, the instances it spawned and its log records. */
function advancedShown(
  test: TestRuntime,
  directory: string,
  instance: string,
  { state, spawned, logs }: Advanced,
): Record<string, unknown> {
  return { ...stateShown(test, directory, instance, state), spawned, logs: logs.map(logLine) };
}

/** What inspecting `instance` read: its state, and where each execution waits. */
function inspectionShown(
  test: TestRuntime,
  directory: string,
  instance: string,
  { state, waitingAt }: Inspection,
): Record<string, unknown> {
  const relative = pathToFileURL(directory).href;
  return {
    ...stateShown(test, directory, instance, state),
    waitingAt: waitingAt.map(({ waypoint, location }) => ({
      waypoint,
      location: location.replace(relative, ''),
    })),
  };
}

/** `state`, an instance's, as a scenario shows it. */
function stateShown(
  test: TestRuntime,
  directory: string,
  instance: string,
  state: InstanceState,
): Record<string, unknown> {
  switch (state.kind) {
    case 'finished':
      return { finished: outcomeTextOf(test, instance, state) };
    case 'panicked':
    case 'terminated':
      return { [state.kind]: state.message, frame: frameIn(directory, state.trace) };
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
  test: TestRuntime,
  instance: string,
  state: Extract<InstanceState, { kind: 'finished' }>,
): string | null {
  try {
    return test.programOf(instance).outcomeText(state);
  } catch (error) {
    if (error instanceof Refusal) {
      return null;
    }
    throw error;
  }
}

/** `frame`, a trace's, its file named relative to `directory`. */
function relativeFrame(directory: string, frame: string): string {
  return frame.replace(pathToFileURL(directory).href, '');
}

/** The innermost frame of `trace` in the program's own modules, named relative to `directory`. */
function frameIn(directory: string, trace: string): string {
  return relativeFrame(directory, innermostOwnFrame(trace));
}

/** The externs `program`'s host module implements, loaded afresh; none without one. */
async function hostOf({ directory, host }: ProgramRun): Promise<HostExterns> {
  return host === undefined ? {} : await freshHost(`${directory}${host}`);
}
