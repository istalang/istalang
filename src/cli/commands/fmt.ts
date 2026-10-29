/**
 * `ista fmt [files…]`: rewrite modules in the canonical format (docs/work/m6-m7/formatter.md).
 *
 * With no files, every source under the project root. `--check` writes nothing and lists the files
 * that would change, for CI. A file with syntax errors is reported and left as it is: the parser
 * recovered from them by guessing, and printing its guesses would rewrite code the user didn't
 * write. Every named file is read before any is written, so a typo in the command line changes
 * nothing.
 *
 * Exit codes: 0 when every file is formatted (with `--check`, already was), 1 when a file has
 * syntax errors or `--check` found one to change, and 2 when a named file can't be read.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { formatSource } from '../../formatter/format.ts';
import { createSourceText } from '../../text/source-text.ts';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from '../command.ts';
import { isSystemError } from '../errno.ts';
import { findProjectSources } from '../project.ts';
import { reportDiagnostics } from '../report.ts';

interface FmtOptions {
  readonly check?: boolean;
}

export const defineFmtCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('fmt')
    .description('rewrite modules in the canonical format')
    .argument('[files...]', 'modules to format (default: every .ista file in the project)')
    .option('--check', 'list the files that would change, without writing them')
    .action((files: string[], options: FmtOptions) => {
      exitWith(fmt(files, options.check === true, environment));
    });
};

/** The system errors saying a path names no file to read. */
const noFile: ReadonlySet<string> = new Set(['ENOENT', 'EISDIR', 'ENOTDIR']);

/** The text of the file at `path`, or undefined when there is none to read. */
function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (isSystemError(error) && noFile.has(error.code)) {
      return undefined;
    }
    throw error;
  }
}

function fmt(files: readonly string[], check: boolean, environment: CliEnvironment): ExitCode {
  const { cwd } = environment;
  const paths =
    files.length > 0 ? files.map((file) => resolve(cwd, file)) : findProjectSources(cwd);
  const read = paths.map((path) => ({ path, text: readText(path) }));
  const unreadable = read.filter(({ text }) => text === undefined);
  if (unreadable.length > 0) {
    environment.writeError(
      unreadable.map(({ path }) => `ista: no such file: ${relative(cwd, path)}\n`).join(''),
    );
    return exitCodes.couldNotRun;
  }
  const results = read.map(({ path, text = '' }) => ({
    path,
    original: text,
    ...formatSource(createSourceText(relative(cwd, path), text)),
  }));
  const refused = results.filter(({ text }) => text === undefined);
  reportDiagnostics(
    refused.map(({ tree }) => ({ source: tree.source, diagnostics: tree.diagnostics })),
    environment.writeError,
  );
  const changed = results.flatMap(({ path, original, text }) =>
    text === undefined || text === original ? [] : [{ path, text }],
  );
  for (const { path, text } of changed) {
    if (check) {
      environment.write(`${relative(cwd, path)}\n`);
    } else {
      writeFileSync(path, text);
    }
  }
  return refused.length > 0 || (check && changed.length > 0) ? exitCodes.problems : exitCodes.clean;
}
