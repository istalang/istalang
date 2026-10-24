/**
 * `ista check [files…]`: report every problem the compiler finds in the given modules and in
 * everything they import, without running anything.
 *
 * With no files, every `.ista` file under the project root is a root (§3.13). Exit codes: 0 when
 * there are no errors (warnings alone don't fail a check), 1 when there are, and 2 when a named
 * file can't be read, which is a mistake in the command line rather than in the code.
 */

import { diagnose } from '../../compiler/compile.ts';
import { renderDiagnostic } from '../../diagnostics/render.ts';
import type { CliEnvironment, CommandDefinition } from '../command.ts';
import { findProjectSources, loadProject } from '../project.ts';

export const defineCheckCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('check')
    .description('report problems in modules and everything they import')
    .argument('[files...]', 'modules to check (default: every .ista file in the project)')
    .action((files: string[]) => {
      exitWith(check(files, environment));
    });
};

function check(files: readonly string[], environment: CliEnvironment): number {
  const { cwd } = environment;
  const { program, unreadable } = loadProject(
    cwd,
    files.length > 0 ? files : findProjectSources(cwd),
  );
  if (unreadable.length > 0) {
    environment.writeError(unreadable.map((file) => `ista: no such file: ${file}\n`).join(''));
    return 2;
  }
  const results = [...diagnose(program).values()];
  const reports = results.flatMap(({ source, diagnostics }) =>
    diagnostics.map((diagnostic) => renderDiagnostic(source, diagnostic)),
  );
  const all = results.flatMap((result) => result.diagnostics);
  const errors = all.filter((diagnostic) => diagnostic.severity === 'error').length;
  if (reports.length > 0) {
    const warnings = all.length - errors;
    environment.write(`${reports.join('\n\n')}\n\n${summary(errors, warnings)}\n`);
  }
  return errors > 0 ? 1 : 0;
}

function summary(errors: number, warnings: number): string {
  const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  return `${counted(errors, 'error')}, ${counted(warnings, 'warning')}.`;
}
