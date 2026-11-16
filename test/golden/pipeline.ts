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
import { loadHostModule } from '../../src/cli/host-module.ts';
import { compileProgram, diagnose } from '../../src/compiler/compile.ts';
import { moduleIdOf } from '../../src/compiler/program/program.ts';
import type { Definition } from '../../src/definition/definition.ts';
import { isError } from '../../src/foundation/diagnostics/diagnostic.ts';
import { loadProject } from '../../src/project/project.ts';
import type { HostExterns } from '../../src/runtime/boundary/host-natives.ts';
import { ManualClock } from '../../src/runtime/clock.ts';
import { startLive } from '../../src/runtime/program.ts';
import { stdNatives } from '../../src/stdlib/natives.ts';
import {
  hostCallLine,
  innermostOwnFrame,
  logLine,
  type Observation,
  panicEnding,
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

/** What running `definition`'s `main` on the run showed. */
export async function shownByRun(
  definition: Definition,
  host: RecordingHost = recording({}),
): Promise<Observation> {
  const { end, logs } = await startLive(definition, {
    natives: stdNatives,
    externs: host.externs,
    clock: new ManualClock(),
    seed: new Uint8Array(32),
  });
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

/** What running `program` showed; the first error it reports when it doesn't compile. */
export async function observeProgram(
  program: ProgramRun,
): Promise<Observation | { readonly problem: string }> {
  const compiled = compiledAt(program.directory, program.path, program.text);
  if ('problem' in compiled) {
    return compiled;
  }
  const observed = await shownByRun(compiled.definition, recording(await hostOf(program)));
  const { ending: ended } = observed;
  return 'frame' in ended
    ? { ...observed, ending: { ...ended, frame: relativeFrame(program.directory, ended.frame) } }
    : observed;
}

/**
 * The lines `ista test` prints for the test modules `paths` in `project`, every module under it
 * without any; throws when the run doesn't pass, whose output is no result to record.
 */
export function observeSuite(
  _project: SuiteProject,
  _paths: readonly string[],
): Promise<readonly string[]> {
  return Promise.reject(new Error('ista test runs on the new pipeline later in R1.'));
}

/** What each step of `scenario` showed, in order (scenarios.ts). */
export function observeScenario(scenario: Scenario): Promise<readonly unknown[]> {
  void readFileSync;
  void innermostOwnFrame;
  return Promise.reject(new Error(`${scenario.name}: the host API runs on the new pipeline later in R1.`));
}

/** `frame`, a trace's, its file named relative to `directory`. */
function relativeFrame(directory: string, frame: string): string {
  return frame.replace(pathToFileURL(directory).href, '');
}

/** The externs `program`'s host module implements, loaded afresh; none without one. */
async function hostOf({ directory, host }: ProgramRun): Promise<HostExterns> {
  return host === undefined ? {} : await freshHost(`${directory}${host}`);
}
