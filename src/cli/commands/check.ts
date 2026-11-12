/**
 * `ista check [files…]`: report every problem the compiler finds in the given modules and in
 * everything they import, without running anything.
 *
 * With no files, every `.ista` file under the project root is a root (§3.13). Exit codes: 0 when
 * there are no errors (warnings alone don't fail a check), 1 when there are, and 2 when a named
 * file can't be read, which is a mistake in the command line rather than in the code.
 */

import { diagnose } from '../../compiler/compile.ts';
import { findProjectSources, loadProject } from '../../project/project.ts';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from '../command.ts';
import { reportDiagnostics, reportUnreadable } from '../report.ts';

export const defineCheckCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('check')
    .description('report problems in modules and everything they import')
    .argument('[files...]', 'modules to check (default: every .ista file in the project)')
    .action((files: string[]) => {
      exitWith(check(files, environment));
    });
};

function check(files: readonly string[], environment: CliEnvironment): ExitCode {
  const { cwd } = environment;
  const { program, unreadable } = loadProject(
    cwd,
    files.length > 0 ? files : findProjectSources(cwd),
  );
  if (unreadable.length > 0) {
    reportUnreadable(unreadable, environment.writeError);
    return exitCodes.couldNotRun;
  }
  return reportDiagnostics(diagnose(program), environment.write) > 0
    ? exitCodes.problems
    : exitCodes.clean;
}
