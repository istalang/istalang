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

import type { Definition } from '../definition/definition.ts';
import type { Diagnostic } from '../diagnostics/diagnostic.ts';
import type { SourceText } from '../text/source-text.ts';
import { bindProgram } from './binder/bind.ts';
import { checkProgram } from './checker/check.ts';
import { lower } from './lowering/lower.ts';
import type { ModuleId, Program } from './program/program.ts';
import type { FunctionDeclaration } from './syntax/declarations.ts';

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
    const bindings = bindProgram(program);
    const checker = checkProgram(program);
    result = new Map(
      [...program.modules].map(([id, { tree, diagnostics }]) => [
        id,
        {
          source: tree.source,
          diagnostics: [
            ...tree.diagnostics,
            ...diagnostics,
            ...bindings.diagnosticsOf(id),
            ...checker.diagnosticsOf(id),
          ].sort((first, second) => first.span.start - second.span.start),
        },
      ]),
    );
    diagnosed.set(program, result);
  }
  return result;
}

/** A program compiled for running, or why it couldn't be. */
export type Compilation =
  | { readonly kind: 'compiled'; readonly definition: Definition }
  /** Some module has errors; `diagnose` lists them. */
  | { readonly kind: 'failed' }
  /** The entry module declares no `async fn main()` (§9). */
  | { readonly kind: 'noMain' };

const compiled = new WeakMap<Program, Map<ModuleId, Compilation>>();

/** The Definition that runs `entry`'s `main`, when the program has no errors (§9). */
export function compileProgram(program: Program, entry: ModuleId): Compilation {
  const byEntry = compiled.get(program) ?? new Map<ModuleId, Compilation>();
  compiled.set(program, byEntry);
  let compilation = byEntry.get(entry);
  if (compilation === undefined) {
    compilation = compile(program, entry);
    byEntry.set(entry, compilation);
  }
  return compilation;
}

function compile(program: Program, entry: ModuleId): Compilation {
  const hasErrors = [...diagnose(program).values()].some(({ diagnostics }) =>
    diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
  );
  if (hasErrors) {
    return { kind: 'failed' };
  }
  const main = mainOf(program, entry);
  if (main === undefined) {
    return { kind: 'noMain' };
  }
  return { kind: 'compiled', definition: lower(checkProgram(program), main) };
}

/** The `async fn main()` that `entry` declares (§9). */
function mainOf(program: Program, entry: ModuleId): FunctionDeclaration | undefined {
  const bindings = bindProgram(program);
  const entity = bindings.exportsOf(entry).get('main');
  if (entity?.kind !== 'functions') {
    return undefined;
  }
  return entity.overloads.find(
    (overload) =>
      overload.isAsync &&
      overload.typeParameters.length === 0 &&
      overload.parameters.length === 0 &&
      !overload.isExtern,
  );
}
