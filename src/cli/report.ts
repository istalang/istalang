/**
 * How the CLI shows a program's diagnostics: each rendered with its source excerpt, then one
 * summary line. Every command that compiles reports through here, so `check` and `run` read the
 * same. `check` writes them as its output; `run` keeps its output for the outcome and writes them
 * to the error stream. A path the command line names that names no file is reported here too, so
 * every command words it alike.
 */

import type { ModuleDiagnostics } from '../compiler/compile.ts';
import { isError } from '../diagnostics/diagnostic.ts';
import { renderDiagnostic } from '../diagnostics/render.ts';
/** Writes every diagnostic of `results` through `write`; how many of them are errors. */
export function reportDiagnostics(
  results: Iterable<ModuleDiagnostics>,
  write: (text: string) => void,
): number {
  const modules = [...results];
  const reports = modules.flatMap(({ source, diagnostics }) =>
    diagnostics.map((diagnostic) => renderDiagnostic(source, diagnostic)),
  );
  const all = modules.flatMap((result) => result.diagnostics);
  const errors = all.filter(isError).length;
  if (reports.length > 0) {
    write(`${reports.join('\n\n')}\n\n${summary(errors, all.length - errors)}\n`);
  }
  return errors;
}

/** Writes, through `writeError`, each path a command line named that names no file, as given. */
export function reportUnreadable(
  paths: readonly string[],
  writeError: (text: string) => void,
): void {
  writeError(paths.map((path) => `ista: no such file: ${path}\n`).join(''));
}

function summary(errors: number, warnings: number): string {
  const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  return `${counted(errors, 'error')}, ${counted(warnings, 'warning')}.`;
}
