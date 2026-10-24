/**
 * The compiler's coordinator: from a loaded Program onward, the one module that knows the order of
 * the phases. Loading itself (scanning, parsing, resolving imports) belongs to program/, because
 * finding a module's imports needs its tree. Each phase knows only its own input and output; apps
 * ask this module for results.
 *
 * Results are derived from an immutable Program and memoized on it, so asking twice costs nothing
 * and a new snapshot simply derives afresh. Diagnostics come back for every module, keyed by the
 * module's id, clean ones included, because an editor addresses documents by that id and needs to
 * know which to clear.
 */

import type { Diagnostic } from '../diagnostics/diagnostic.ts';
import type { SourceText } from '../text/source-text.ts';
import type { ModuleId, Program } from './program/program.ts';

export interface ModuleDiagnostics {
  readonly source: SourceText;
  /** Sorted by position. */
  readonly diagnostics: readonly Diagnostic[];
}

const diagnosed = new WeakMap<Program, ReadonlyMap<ModuleId, ModuleDiagnostics>>();

/** Every module's diagnostics from every phase, in load order. */
export function diagnose(program: Program): ReadonlyMap<ModuleId, ModuleDiagnostics> {
  let result = diagnosed.get(program);
  if (result === undefined) {
    result = new Map(
      [...program.modules].map(([id, { tree, diagnostics }]) => [
        id,
        {
          source: tree.source,
          diagnostics: [...tree.diagnostics, ...diagnostics].sort(
            (first, second) => first.span.start - second.span.start,
          ),
        },
      ]),
    );
    diagnosed.set(program, result);
  }
  return result;
}
