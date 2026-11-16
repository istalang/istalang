/**
 * `ista build <entry> --out <file>`: compile the program rooted at `entry` to one JavaScript ES
 * module, which imports the runtime library as `istalang/live` and default-exports the program a
 * host starts (live/program.ts): its Definition's text and the code compiled from it, so starting
 * it compiles nothing. It runs in a browser or Node, its ista code too, the contexts it calls kept
 * in memory for the run.
 *
 * Nothing is written unless the whole program checks clean. Diagnostics, warnings included, go to
 * the error stream as `check` renders them.
 * Exit codes: 0 when the module is written; 1 when the program has errors or declares no `main`;
 * 2 when the entry can't be read or the module can't be written.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { builtModule, emitProgram } from '../../codegen/emit.ts';
import { embeddedText } from '../../definition/definition.ts';
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
  const { encoded } = compiled;
  const text = builtModule(embeddedText(encoded), emitProgram(encoded.definition));
  const out = resolve(environment.cwd, options.out);
  try {
    writeFileSync(out, text);
  } catch (error) {
    environment.writeError(`ista: can't write ${out}: ${String(error)}\n`);
    return exitCodes.couldNotRun;
  }
  return exitCodes.clean;
}
