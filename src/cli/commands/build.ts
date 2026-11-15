/**
 * `ista build <entry> --out <file>`: compile the program rooted at `entry` to one JavaScript ES
 * module (docs/work/js-codegen/design.md), which imports the runtime library as `istalang/live` and
 * default-exports the program a host starts. Its live and simple code runs in a browser or Node;
 * ista code stays on the interpreter, so a program reaching any is refused, naming it.
 *
 * Nothing is written unless the whole program checks clean. Diagnostics, warnings included, go to
 * the error stream as `check` renders them.
 * Exit codes: 0 when the module is written; 1 when the program has errors, declares no `main`, or
 * reaches ista code; 2 when the entry can't be read or the module can't be written.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emitProgram } from '../../codegen/emit.ts';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from '../command.ts';
import { compiledEntry } from '../compile-entry.ts';

interface BuildOptions {
  readonly out: string;
}

export const defineBuildCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('build')
    .description("compile a program's live and simple code to a JavaScript module")
    .argument('<entry>', 'the module declaring main')
    .requiredOption('--out <file>', 'the JavaScript module to write')
    .action((entry: string, options: BuildOptions) => {
      exitWith(build(entry, options, environment));
    });
};

function build(entry: string, options: BuildOptions, environment: CliEnvironment): ExitCode {
  const compiled = compiledEntry(environment, entry);
  if ('exit' in compiled) {
    return compiled.exit;
  }
  const emitted = emitProgram(compiled.definition, { runtime: 'istalang/live' });
  if (emitted.kind === 'refused') {
    environment.writeError(`ista: ${emitted.problem}.\n`);
    return exitCodes.problems;
  }
  const out = resolve(environment.cwd, options.out);
  try {
    writeFileSync(out, emitted.text);
  } catch (error) {
    environment.writeError(`ista: can't write ${out}: ${String(error)}\n`);
    return exitCodes.couldNotRun;
  }
  return exitCodes.clean;
}
