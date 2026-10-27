/**
 * The `ista` command line: commander, with one module per subcommand listed in `commands`.
 *
 * Commander parses arguments and writes help and usage errors; it is configured never to exit
 * the process, so `runCli` always returns the exit code. A subcommand reports its own code. Exit
 * code 2 means the command couldn't run as asked: a usage error from commander (unknown command,
 * missing argument), or a file the system refused to read. Any other exception is a bug in the
 * toolchain and propagates with its stack.
 */

import { readFileSync } from 'node:fs';
import { Command, CommanderError } from 'commander';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from './command.ts';
import { defineCheckCommand } from './commands/check.ts';
import { defineRunCommand } from './commands/run.ts';
import { defineTestCommand } from './commands/test.ts';
import { isSystemError } from './errno.ts';

const commands: readonly CommandDefinition[] = [
  defineCheckCommand,
  defineRunCommand,
  defineTestCommand,
];

/** Runs `ista` with `args` (without the node and script paths); resolves to the exit code. */
export async function runCli(
  args: readonly string[],
  environment: CliEnvironment,
): Promise<ExitCode> {
  let exitCode: ExitCode = exitCodes.clean;
  const cli = new Command('ista')
    .description('Toolchain for Istalang')
    .version(packageVersion())
    .exitOverride()
    .configureOutput({
      writeOut: (text) => environment.write(text),
      writeErr: (text) => environment.writeError(text),
    });
  const context = {
    environment,
    exitWith: (code: ExitCode) => {
      exitCode = code;
    },
  };
  for (const define of commands) {
    define(cli, context);
  }
  try {
    await cli.parseAsync([...args], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === exitCodes.clean ? exitCodes.clean : exitCodes.couldNotRun;
    }
    if (!isSystemError(error)) {
      throw error;
    }
    environment.writeError(`ista: ${error.message}\n`);
    return exitCodes.couldNotRun;
  }
  return exitCode;
}

/** The package's own manifest sits two levels up from this module, in `src` and in `dist` alike. */
function packageVersion(): string {
  return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
}
