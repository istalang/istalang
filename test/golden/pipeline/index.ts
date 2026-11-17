/**
 * The pipeline the goldens run on, and the one folder that knows it: a new pipeline replaces this
 * folder and nothing else of the runner (docs/work/ir-first/contracts.md, "Goldens").
 *
 * Today's compiles a program to its Definition, emits it as JavaScript and runs it on the one run
 * (src/runtime), on a manual clock that moves only to the next due timer, from 0, and the
 * all-zero seed, so timers and random values repeat. A program runs its `main` as a host starts
 * it; a scenario's steps drive the host API (scenario-run.ts); a suite runs through `ista test`,
 * which fixes its own clock and seed per test. A host module is loaded afresh for each run, since
 * it may keep state.
 *
 * Compiling is apart from running, so whatever runs a program many ways compiles it once.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';
import { testModules } from '../../../src/cli/commands/test.ts';
import { loadHostModule } from '../../../src/cli/host-module.ts';
import type { EmittedProgram } from '../../../src/codegen/emit.ts';
import { compileProgram, diagnose } from '../../../src/compiler/compile.ts';
import { type ModuleId, moduleIdOf, type Program } from '../../../src/compiler/program/program.ts';
import { encodeDefinition } from '../../../src/definition/definition.ts';
import type { Definition } from '../../../src/definition/tables/index.ts';
import { isError } from '../../../src/foundation/diagnostics/diagnostic.ts';
import { tempProject } from '../../../src/project/project.test-kit.ts';
import { loadProject } from '../../../src/project/project.ts';
import type { HostExterns } from '../../../src/runtime/boundary/host-natives.ts';
import { ManualClock } from '../../../src/runtime/clock.ts';
import { type Start, startLive } from '../../../src/runtime/program.ts';
import { stdNatives } from '../../../src/stdlib/natives.ts';
import {
  hostCallLine,
  innermostOwnFrame,
  logLine,
  type Observation,
  panicEnding,
} from '../observation.ts';

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

/** A program compiled: what its module loaded into, and the Definition running its `main`. */
export interface Compiled {
  readonly program: Program;
  readonly definition: Definition;
}

/**
 * The module `text` at `path` in `directory` compiled, `prepare` done first to the program it
 * loaded into if given, such as numbering its identities in an order of its own; or the first
 * error it reports.
 */
export function compiledAt(
  directory: string,
  path: string,
  text: string,
  prepare?: (program: Program, module: ModuleId) => void,
): Compiled | { readonly problem: string } {
  const id = moduleIdOf(pathToFileURL(join(directory, path)));
  const { program } = loadProject(directory, [], {
    buffers: [{ id, name: path.replace(ending, ''), label: path, read: () => text }],
  });
  prepare?.(program, id);
  const compilation = compileProgram(program, id);
  if (compilation.kind === 'compiled') {
    return { program, definition: compilation.definition };
  }
  const [error] = [...diagnose(program).values()].flatMap(({ diagnostics }) =>
    diagnostics.filter(isError),
  );
  return {
    problem: error === undefined ? compilation.kind : `error ${error.code}: ${error.message}`,
  };
}

/** A host's externs, and the calls they were given, in order, as observation lines. */
interface RecordingHost {
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
async function freshHost(path: string): Promise<HostExterns> {
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
async function shownByRun(
  definition: Definition,
  host: RecordingHost = recording({}),
  start: Start = {},
  readBack?: ReadBack,
): Promise<Observation> {
  const binding = {
    natives: stdNatives,
    externs: host.externs,
    clock: new ManualClock(),
    seed: () => new Uint8Array(32),
  };
  const live = readBack === undefined ? {} : { readBack: () => readBack(definition) };
  const { end, logs } = await startLive(encodeDefinition(definition), binding, start, live);
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
 * What running `definition`, compiled from `program`, showed, each run read back from a snapshot
 * into `readBack`'s build if given.
 */
export async function observeCompiled(
  definition: Definition,
  program: ProgramRun,
  start: Start = {},
  readBack?: ReadBack,
): Promise<Observation> {
  const host = recording(await hostOf(program));
  const observed = await shownByRun(definition, host, start, readBack);
  const { ending: ended } = observed;
  return 'frame' in ended
    ? { ...observed, ending: { ...ended, frame: relativeLocation(program.directory, ended.frame) } }
    : observed;
}

/**
 * Runs the test modules `paths` in `project` as `ista test` does, every module under it without
 * any; throws with what it printed when the run doesn't pass.
 */
export async function runSuite(project: SuiteProject, paths: readonly string[]): Promise<void> {
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
}

/** `trace`'s innermost frame of the program's own, its file named relative to `directory`. */
export function frameIn(directory: string, trace: string): string {
  return relativeLocation(directory, innermostOwnFrame(trace));
}

/** `located`, a trace's frame or a location in code, its file named relative to `directory`. */
export function relativeLocation(directory: string, located: string): string {
  return located.replace(pathToFileURL(directory).href, '');
}

/** The externs `program`'s host module implements, loaded afresh; none without one. */
export async function hostOf({ directory, host }: ProgramRun): Promise<HostExterns> {
  return host === undefined ? {} : await freshHost(`${directory}${host}`);
}
