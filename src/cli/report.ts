/**
 * How the CLI shows a program's diagnostics: each rendered with its source excerpt, then one
 * summary line. Every command that compiles reports through here, so `check` and `run` read the
 * same. `check` writes them as its output; `run` keeps its output for the outcome and writes them
 * to the error stream.
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

function summary(errors: number, warnings: number): string {
  const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  return `${counted(errors, 'error')}, ${counted(warnings, 'warning')}.`;
}
