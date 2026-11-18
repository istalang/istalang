/**
 * `ista fmt [files…]`: rewrite modules in the canonical format (docs/work/done/m6-m7/formatter.md).
 *
 * With no files, every source under the project root. A module whose banner disables formatting
 * (`# disable-ista-formatter`) is left as it is, syntax errors and all. `--check` writes nothing and lists the files
 * that would change, for CI. A file with syntax errors is reported and left as it is: the parser
 * recovered from them by guessing, and printing its guesses would rewrite code the user didn't
 * write. Every named file is found before any is written, so a typo in the command line changes
 * nothing. Files are read through project/'s seam, so a path names a file for `fmt` exactly when
 * it does for `check`.
 *
 * Exit codes: 0 when every file is formatted (with `--check`, already was), 1 when a file has
 * syntax errors or `--check` found one to change, and 2 when a named file can't be read.
 */

import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { formatSource, isFormattingDisabled } from '../../formatter/format.ts';
import { createSourceText } from '../../foundation/text/source-text.ts';
import { findProjectSources } from '../../project/project.ts';
import { diskFiles } from '../../project/project-files.ts';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from '../command.ts';
import { reportDiagnostics, reportUnreadable } from '../report.ts';

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

function fmt(files: readonly string[], check: boolean, environment: CliEnvironment): ExitCode {
  const { cwd } = environment;
  const named = files.length > 0 ? files : findProjectSources(cwd);
  const unreadable = named.filter((file) => !diskFiles.isFile(resolve(cwd, file)));
  if (unreadable.length > 0) {
    reportUnreadable(unreadable, environment.writeError);
    return exitCodes.couldNotRun;
  }
  const results = named.map((file) => {
    const path = resolve(cwd, file);
    const original = diskFiles.read(path);
    const { tree, text } = formatSource(createSourceText(relative(cwd, path), original));
    return { path, original, tree, text: isFormattingDisabled(tree) ? original : text };
  });
  const refused = results.filter(({ text }) => text === undefined);
  reportDiagnostics(
    new Map(
      refused.map(({ path, tree }) => [
        path,
        { source: tree.source, diagnostics: tree.diagnostics },
      ]),
    ),
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
