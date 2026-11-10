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
import {
  compareDiagnostics,
  type Diagnostic,
  isError,
} from '../foundation/diagnostics/diagnostic.ts';
import { entryFunction } from '../foundation/language/well-known/index.ts';
import { memo } from '../foundation/structures/memo.ts';
import type { SourceText } from '../foundation/text/source-text.ts';
import { bindProgram } from './binder/bind.ts';
import { checkProgram } from './checker/check.ts';
import { lower, lowerTests } from './lowering/lower.ts';
import { type ModuleId, type Program, programModule } from './program/program.ts';
import type { FunctionDeclaration } from './syntax/declarations/index.ts';
import { awaits } from './syntax/tokens/modifiers.ts';

export interface ModuleDiagnostics {
  readonly source: SourceText;
  /** Sorted by position. */
  readonly diagnostics: readonly Diagnostic[];
}

const diagnosed = new WeakMap<Program, ReadonlyMap<ModuleId, ModuleDiagnostics>>();
const diagnosedModules = new WeakMap<Program, Map<ModuleId, ModuleDiagnostics>>();

/**
 * Every module's diagnostics from every phase, in load order. A module the toolchain ships is
 * checked once, by its own tests (stdlib/std-modules.test.ts), rather than by every compile: what
 * a program uses of it is still checked, lazily, when lowering reads it.
 */
export function diagnose(program: Program): ReadonlyMap<ModuleId, ModuleDiagnostics> {
  return memo(
    diagnosed,
    program,
    () => new Map([...program.modules.keys()].map((id) => [id, diagnoseModule(program, id)])),
  );
}

/** One module's diagnostics from every phase, in their order (`compareDiagnostics`); an editor asks per document. */
export function diagnoseModule(program: Program, id: ModuleId): ModuleDiagnostics {
  const modules = memo(diagnosedModules, program, () => new Map<ModuleId, ModuleDiagnostics>());
  return memo(modules, id, () => {
    const { tree, diagnostics, isStd } = programModule(program, id);
    return {
      source: tree.source,
      diagnostics: [
        ...tree.diagnostics,
        ...diagnostics,
        ...bindProgram(program).diagnosticsOf(id),
        ...(isStd ? [] : checkProgram(program).diagnosticsOf(id)),
      ].sort(compareDiagnostics),
    };
  });
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
  const byEntry = memo(compiled, program, () => new Map<ModuleId, Compilation>());
  return memo(byEntry, entry, () => compile(program, entry));
}

function compile(program: Program, entry: ModuleId): Compilation {
  if (hasErrors(program)) {
    return { kind: 'failed' };
  }
  const main = mainOf(program, entry);
  if (main === undefined) {
    return { kind: 'noMain' };
  }
  return { kind: 'compiled', definition: lower(checkProgram(program), main) };
}

/** A program's tests compiled for running (§10), or why they couldn't be. */
export type TestCompilation =
  | { readonly kind: 'compiled'; readonly definition: Definition }
  /** Some module has errors; `diagnose` lists them. */
  | { readonly kind: 'failed' }
  /** No module of the program's own declares a `@Suite` function. */
  | { readonly kind: 'noTests' };

const compiledTests = new WeakMap<Program, TestCompilation>();

/** The Definition that runs every `@Suite` function of `program`'s own modules (§10). */
export function compileTests(program: Program): TestCompilation {
  return memo(compiledTests, program, () => {
    if (hasErrors(program)) {
      return { kind: 'failed' };
    }
    const checker = checkProgram(program);
    const suites = [...program.modules].flatMap(([id, { tree, isStd }]) =>
      isStd
        ? []
        : tree.root.items.flatMap((item) => {
            const title =
              item.kind === 'FunctionDeclaration'
                ? checker.annotations.suiteTitleOf(id, item)
                : undefined;
            return item.kind === 'FunctionDeclaration' && title !== undefined
              ? [{ title, declaration: item }]
              : [];
          }),
    );
    return suites.length === 0
      ? { kind: 'noTests' }
      : { kind: 'compiled', definition: lowerTests(checker, suites) };
  });
}

/** Whether any module of `program` has an error. */
function hasErrors(program: Program): boolean {
  return [...diagnose(program).values()].some(({ diagnostics }) => diagnostics.some(isError));
}

/** The `async fn main()` that `entry` declares (§9). */
function mainOf(program: Program, entry: ModuleId): FunctionDeclaration | undefined {
  const bindings = bindProgram(program);
  const entity = bindings.exportsOf(entry).get(entryFunction);
  if (entity?.kind !== 'functions') {
    return undefined;
  }
  return entity.overloads.find(
    (overload) =>
      awaits(overload.qualifiers) &&
      overload.typeParameters.length === 0 &&
      overload.parameters.length === 0 &&
      !overload.isExtern,
  );
}
