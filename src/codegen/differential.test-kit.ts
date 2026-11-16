/**
 * Running a program as compiled JavaScript and reading what it showed, as the goldens' pipeline reads
 * an interpreter run (test/golden/pipeline.ts, `shownByInterpreter`): how it ended, its log records,
 * and the calls its host saw. The interpreter is the reference.
 *
 * - Both run on a manual clock and one seed, so timers and random values agree.
 * - A panic shows its message and innermost frame: after an `await` a compiled trace holds only
 *   the frames since the execution resumed (tracker F35).
 * - The corpus starts each program's work as ista code in a context (`runtime.run`), which stays on
 *   the interpreter, so `asLive` starts it as live code instead, its ista functions and futures
 *   marked live; one that then doesn't check as live code needs the interpreter.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logLine, type Observation, panicEnding } from '../../test/golden/observation.ts';
import { type RecordingHost, recording } from '../../test/golden/pipeline.ts';
import type { Definition } from '../definition/definition.ts';
import type { LiveProgram } from '../live/program.ts';
import { ManualClock } from '../runtime/clock.ts';
import { testSeed } from '../runtime/runtime.test-kit.ts';
import { emitProgram } from './emit.ts';

/** How the corpus starts a program's work in a context. */
const inContext = /await runtime\.run\(runtime\.id\(\)\) _main\(\)/u;
/** A function's mark, or a future's kind, saying it is ista code. */
const istaMark = /\bista(?=\s+(?:async\s+)?fn\b)/gu;
const istaKind = /"ista"/gu;

/**
 * `text`, a corpus program, with its work started as live code rather than in a context, and every
 * function and future it marks ista marked live; what then still needs ista code doesn't check.
 */
export function asLive(text: string): string {
  return text
    .replace(inContext, 'await _main()')
    .replace(istaMark, 'live')
    .replace(istaKind, '"live"');
}

const emitted = mkdtempSync(join(tmpdir(), 'ista-js-'));
const runtimeLibrary = pathToFileURL(
  fileURLToPath(new URL('../live/program.ts', import.meta.url)),
).href;
let modules = 0;

/** `definition` compiled to JavaScript and loaded; a problem when it can't run as JavaScript. */
export async function compiledToJavaScript(definition: Definition): Promise<LiveProgram | string> {
  const result = emitProgram(definition, { runtime: runtimeLibrary, checksCounted: true });
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
): Promise<Observation> {
  const ended = await program.start({
    externs: host.externs,
    clock: new ManualClock(),
    seed: testSeed,
  });
  const shown = { logs: ended.logs.map(logLine), hostCalls: host.calls };
  return ended.kind === 'finished'
    ? { ending: { outcome: ended.text }, ...shown }
    : { ending: panicEnding(ended.message, ended.trace), ...shown };
}
