/**
 * The corpus programs, each stating what it must do, so every phase that compiles or runs whole
 * programs reads them here and a new program is picked up by all of them (docs/work/toolchain-v0.1/
 * m3-slices.md, "Corpus format").
 *
 * - Programs live in `test/corpus/<topic>/…`, one module each, read recursively.
 * - A valid program's first line is `# outcome: <json>` or `# panic: <message>`.
 * - An invalid program's header is one line per diagnostic it must report, and no other:
 *   `# error: <code> at <line>:<column>`, both 1-based.
 * - `names/` is a corpus of modules importing each other, read by the binder's own tests.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A program that compiles, with what running it must give. */
export interface RunProgram {
  /** Its path from the corpus directory, which is also how `ista run` names it there. */
  readonly name: string;
  readonly text: string;
  readonly expects: 'outcome' | 'panic';
  /** The outcome's JSON, or the panic's message. */
  readonly expected: string;
}

/** A program that doesn't compile, with exactly the diagnostics it must report. */
export interface InvalidProgram {
  readonly name: string;
  readonly text: string;
  readonly errors: readonly ExpectedError[];
}

interface ExpectedError {
  readonly code: number;
  readonly line: number;
  readonly column: number;
}

/** The directory the corpus is in, for running its programs where they are. */
export const corpusDirectory = fileURLToPath(new URL('./', import.meta.url));

/** Directories of the corpus that hold modules rather than programs. */
const moduleCorpora = new Set(['names']);

const outcome = /^# (?<expects>outcome|panic): (?<expected>.*)$/u;
const error = /^# error: (?<code>\d+) at (?<line>\d+):(?<column>\d+)$/u;

/** A module of the corpus, by its path from the corpus directory. */
export interface CorpusFile {
  readonly name: string;
  readonly text: string;
}

/** Every module of the corpus: its programs and the modules of its module corpora. */
export const corpusFiles: readonly CorpusFile[] = readdirSync(corpusDirectory, {
  recursive: true,
  encoding: 'utf8',
})
  .filter((name) => name.endsWith('.ista'))
  .sort()
  .map((name) => ({ name, text: readFileSync(`${corpusDirectory}${name}`, 'utf8') }));

const programs = corpusFiles.filter(({ name }) => !moduleCorpora.has(name.split('/')[0] ?? ''));

export const runPrograms: readonly RunProgram[] = programs.flatMap(({ name, text }) => {
  const { expects, expected } = outcome.exec(text.split('\n')[0] ?? '')?.groups ?? {};
  if (expects !== 'outcome' && expects !== 'panic') {
    return [];
  }
  return [{ name, text, expects, expected: expected ?? '' }];
});

export const invalidPrograms: readonly InvalidProgram[] = programs.flatMap(({ name, text }) => {
  const errors = headerOf(text).flatMap((line) => {
    const groups = error.exec(line)?.groups;
    return groups === undefined
      ? []
      : [{ code: Number(groups.code), line: Number(groups.line), column: Number(groups.column) }];
  });
  if (errors.length === 0 && !runPrograms.some((program) => program.name === name)) {
    throw new Error(`${name} doesn't state what it must do on its first line.`);
  }
  return errors.length === 0 ? [] : [{ name, text, errors }];
});

/** The leading comment lines of a program. */
function headerOf(text: string): readonly string[] {
  const lines = text.split('\n');
  const end = lines.findIndex((line) => !line.startsWith('#'));
  return end < 0 ? lines : lines.slice(0, end);
}
