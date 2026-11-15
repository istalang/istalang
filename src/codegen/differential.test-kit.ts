/**
 * Running one program on both backends, the interpreter and compiled JavaScript, and reading what
 * each run showed (docs/work/js-codegen/design.md, "Verification"): how it ended, its log records,
 * and the calls its host saw. The interpreter is the reference.
 *
 * - Both run on a manual clock and one seed, so timers and random values agree.
 * - A panic shows its message and innermost frame: after an `await` a compiled trace holds only
 *   the frames since the execution resumed (tracker F35).
 * - The corpus starts each program's work as ista code in a context (`runtime.run`), which stays on
 *   the interpreter, so `asLive` starts it as live code instead; one whose work then doesn't check
 *   as live code needs the interpreter.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileProgram, diagnose } from '../compiler/compile.ts';
import { moduleIdOf } from '../compiler/program/program.ts';
import { type Definition, definitionFormat } from '../definition/definition.ts';
import { isError } from '../foundation/diagnostics/diagnostic.ts';
import type { LiveProgram } from '../live/program.ts';
import { loadProject } from '../project/project.ts';
import type { HostExterns } from '../runtime/boundary/host-natives.ts';
import { ManualClock } from '../runtime/clock.ts';
import type { LogRecord } from '../runtime/instance-state.ts';
import { testRuntime, testSeed } from '../runtime/runtime.test-kit.ts';
import { emitProgram } from './emit.ts';

/** What a run showed: how it ended, what it logged, and what its host was called with. */
export interface Shown {
  readonly ended: string;
  readonly logs: readonly string[];
  readonly hostCalls: readonly string[];
}

/** A host's externs, and the calls they were given, in order, as JSON text. */
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
          calls.push(`${key} ${jsonText(argumentValues)}`);
          return extern(argumentValues, call);
        },
      ]),
    ),
  };
}

/** How the corpus starts a program's work in a context, and declares it as ista code. */
const inContext = /await runtime\.run\(runtime\.id\(\)\) _main\(\)/u;
const istaMain = /^ista async fn _main\(/mu;
const ending = /\.ista$/u;

/** `text`, a corpus program, with its work started as live code rather than in a context. */
export function asLive(text: string): string {
  return text.replace(inContext, 'await _main()').replace(istaMain, 'live async fn _main(');
}

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

/** What running `definition`'s `main` on the interpreter showed. */
export async function shownByInterpreter(
  definition: Definition,
  host: RecordingHost = recording({}),
): Promise<Shown> {
  const { runtime } = testRuntime({ host: host.externs, clock: new ManualClock() });
  const deployed = runtime.deploy(definitionFormat.write(definition).text);
  const { state, logs } = await deployed.start('run');
  const shown = { logs: logs.map(logLine), hostCalls: host.calls };
  switch (state.kind) {
    case 'finished':
      return { ended: deployed.outcomeText(state), ...shown };
    case 'panicked':
    case 'terminated':
      return { ended: panicLine(state.message, state.trace), ...shown };
    default:
      return { ended: `ended ${state.kind}`, ...shown };
  }
}

const emitted = mkdtempSync(join(tmpdir(), 'ista-js-'));
const runtimeLibrary = pathToFileURL(
  fileURLToPath(new URL('../live/program.ts', import.meta.url)),
).href;
let modules = 0;

/** `definition` compiled to JavaScript and loaded; a problem when it can't run as JavaScript. */
export async function compiledToJavaScript(definition: Definition): Promise<LiveProgram | string> {
  const result = emitProgram(definition, { runtime: runtimeLibrary });
  if (result.kind === 'refused') {
    return result.problem;
  }
  modules += 1;
  const file = join(emitted, `program-${modules}.mjs`);
  writeFileSync(file, result.text);
  const loaded = (await import(pathToFileURL(file).href)) as { readonly default: LiveProgram };
  return loaded.default;
}

/** What running `program`'s `main`, compiled to JavaScript, showed. */
export async function shownByJavaScript(
  program: LiveProgram,
  host: RecordingHost = recording({}),
): Promise<Shown> {
  const ended = await program.start({
    externs: host.externs,
    clock: new ManualClock(),
    seed: testSeed,
  });
  const shown = { logs: ended.logs.map(logLine), hostCalls: host.calls };
  return ended.kind === 'finished'
    ? { ended: ended.text, ...shown }
    : { ended: panicLine(ended.message, ended.trace), ...shown };
}

function panicLine(message: string, trace: string): string {
  return `panic: ${message} ${trace.split('\n')[0] ?? ''}`;
}

function logLine({ level, message, fields }: LogRecord): string {
  return `${level} ${message} ${jsonText(fields)}`;
}

/** `json`, JSON a host works with, as text, its bigints marked. */
function jsonText(json: unknown): string {
  return JSON.stringify(json, (_key, value: unknown) =>
    typeof value === 'bigint' ? `${value}n` : value,
  );
}
