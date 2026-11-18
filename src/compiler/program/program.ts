/**
 * A program: the modules reachable from its roots, each parsed and with its imports resolved
 * (§3.13). This is the loading core's entry, and it declares the one seam loading depends on.
 *
 * - A `ModuleLoader` turns the string in an import into that module: its identity, its canonical
 *   name, its label, and a way to read its text. Whoever runs the compiler passes in its loaders (files on disk, the std
 *   modules, an editor's open documents, a database), so the core does no I/O and imposes no path
 *   syntax; each loader owns the syntax it accepts.
 * - Finding a module and reading it are separate on purpose. Many imports name one module, and
 *   ambiguity is decided from identities alone, so the core reads a module only when it loads it,
 *   once per build, and builds its SourceText itself; no loader has to cache or invalidate.
 * - A module's id is the URL of its source, under any scheme a loader chooses. Two paths that name
 *   the same module (`'./a'` from one file, `'../a'` from another) must yield the same id: that is
 *   how the core loads each module once and follows cycles. The id is branded and made only from a
 *   parsed URL, so a file path can't stand in for one.
 * - The core keeps the one rule of the language about paths: a path names exactly one module. When
 *   no loader finds one, or several do, the import is a diagnostic on its string and is left out of
 *   `imports`. Loading is total over whatever loaders return; a `read` that throws (the system
 *   refusing a file) propagates to the app, which reports it.
 * - A Program is immutable. Building one with the previous snapshot reuses each tree whose text is
 *   unchanged, by identity, and parses an edited module keeping the nodes of every segment the edit
 *   left alike (parser/incremental/reuse.ts). Everything derived is memoized on those identities,
 *   so an edit re-derives only what it touched, and no cache is invalidated by hand.
 * - Loading, meaning scanning, parsing and resolving, belongs here: discovering a module's imports
 *   needs its tree. The coordinator (compile.ts) takes over from a Program.
 */

import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { type LanguageModule, stdScheme } from '../../foundation/language/well-known/index.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { createSourceText, type SourceText } from '../../foundation/text/source-text.ts';
import { parse } from '../parser/parse.ts';
import { scan } from '../scanner/scan.ts';
import type { ImportDeclaration } from '../syntax/declarations/index.ts';
import type { StringLiteral } from '../syntax/expressions/literals/literals.ts';
import type { SyntaxTree } from '../syntax/tree/index.ts';
import { type AnchoredSpan, diagnosticIn } from '../syntax/tree/positions.ts';
import { programDiagnostics } from './diagnostics.ts';

declare const isModuleUrl: unique symbol;

/** A module's identity: the URL of its source, such as `file:///app/purchase/approve.ista`. */
export type ModuleId = string & { readonly [isModuleUrl]: true };

/** The id of the module whose source is at `url`. */
export function moduleIdOf(url: URL): ModuleId {
  return url.href as ModuleId;
}

/** The id of the std module `name` (§3.8), `std:<name>`. */
export function stdModuleIdOf(name: string): ModuleId {
  return moduleIdOf(new URL(`${stdScheme}:${name}`));
}

/** A module a loader found, not yet read. */
export interface LocatedModule {
  readonly id: ModuleId;
  /**
   * The module's canonical name, which compiled code qualifies its declarations with: the import
   * path that names it from anywhere (§3.13), such as `purchase/approve` or `time`; empty for one
   * no path names, as an editor's unsaved buffer. Unlike the label it never depends on where the
   * toolchain runs, so a compiled program's identity doesn't.
   */
  readonly name: string;
  /** How diagnostics name the module, such as its path from the working directory. */
  readonly label: string;
  /** Whether the toolchain ships the module (§3.8): its externs are the runtime's, not a host's. */
  readonly isStd?: boolean;
  /** Whether the module is a test module (§10): a file ending in `.test.ista`. */
  readonly isTest?: boolean;
  /** The module's text. The core calls it once, when it loads the module; if it throws, so does the build. */
  readonly read: () => string;
}

/** The module an import's path names, as written in `importer`; `undefined` when it names none. */
export type ModuleLoader = (path: string, importer: ModuleId) => LocatedModule | undefined;

export interface ProgramModule {
  readonly id: ModuleId;
  /** The loader's canonical name for the module (`LocatedModule.name`). */
  readonly name: string;
  /** Whether the toolchain ships the module (`LocatedModule.isStd`). */
  readonly isStd: boolean;
  /** Whether the module is a test module (`LocatedModule.isTest`). */
  readonly isTest: boolean;
  readonly tree: SyntaxTree;
  /** The module each import names, for every import that names exactly one. */
  readonly imports: ReadonlyMap<ImportDeclaration, ModuleId>;
  /** Problems loading this module's imports; the tree carries the syntax diagnostics. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface Program {
  readonly roots: readonly ModuleId[];
  /**
   * The std modules the language refers to (foundation/language/well-known/index.ts), as the app
   * supplied them.
   */
  readonly roles: Readonly<Partial<Record<LanguageModule, ModuleId>>>;
  /** Every module reachable from the roots, in load order. */
  readonly modules: ReadonlyMap<ModuleId, ProgramModule>;
}

/** The module `module` of `program`; every module a phase names is one of its program's. */
export function programModule(program: Program, module: ModuleId): ProgramModule {
  const loaded = program.modules.get(module);
  if (loaded === undefined) {
    unreachable(`Module ${module} is not in the program.`);
  }
  return loaded;
}

/** Whether `module` is a test module (`LocatedModule.isTest`); false for one `program` lacks. */
export function isTestModule(program: Program, module: ModuleId): boolean {
  return program.modules.get(module)?.isTest === true;
}

/** Whether the toolchain ships `module` (`LocatedModule.isStd`); false for one `program` lacks. */
export function isStdModule(program: Program, module: ModuleId | undefined): boolean {
  return module !== undefined && program.modules.get(module)?.isStd === true;
}

export interface ProgramOptions {
  /** The modules to start from, located by the app that names them. */
  readonly roots: readonly LocatedModule[];
  /**
   * Every loader is asked for every path; a path two of them answer with different modules is
   * ambiguous (§3.13). When two answer with the same module, the first answer is used, so a loader
   * that should win, such as an editor's open documents, goes first.
   */
  readonly loaders: readonly ModuleLoader[];
  /**
   * The std modules the language refers to, loaded like roots: the prelude, whose exports binding
   * makes visible everywhere; `time`, which types duration literals; `json`, whose codecs values
   * crossing to a host go through; `lifetimes`, whose annotations say what the std's externs hold
   * and keep; and `testing`, which only test modules may import.
   */
  readonly roles?: Readonly<Partial<Record<LanguageModule, LocatedModule>>>;
}

/** Loads the modules reachable from the roots, reusing what an edit left alike of `previous`. */
export function buildProgram(options: ProgramOptions, previous?: Program): Program {
  const modules = new Map<ModuleId, ProgramModule>();
  const roles = Object.entries(options.roles ?? {});
  const queue = [...options.roots, ...roles.map(([, module]) => module)];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { id, name, label, read, isStd = false, isTest = false } = next;
    if (!modules.has(id)) {
      const source = createSourceText(label, read());
      const before = previous?.modules.get(id)?.tree;
      const tree = reusableTree(before, source) ?? parse(source, scan(source), before);
      const { imports, diagnostics, found } = resolveImports(tree, id, options.loaders);
      modules.set(id, { id, name, isStd, isTest, tree, imports, diagnostics });
      queue.push(...found);
    }
  }
  return {
    roots: [...new Set(options.roots.map(({ id }) => id))],
    roles: Object.fromEntries(roles.map(([role, { id }]) => [role, id])),
    modules,
  };
}

function reusableTree(tree: SyntaxTree | undefined, source: SourceText): SyntaxTree | undefined {
  const unchanged = tree?.source.text === source.text && tree.source.path === source.path;
  return unchanged ? tree : undefined;
}

interface ResolvedImports extends Pick<ProgramModule, 'imports' | 'diagnostics'> {
  /** The modules the imports named, to load next. */
  readonly found: readonly LocatedModule[];
}

function resolveImports(
  tree: SyntaxTree,
  importer: ModuleId,
  loaders: readonly ModuleLoader[],
): ResolvedImports {
  const imports = new Map<ImportDeclaration, ModuleId>();
  const diagnostics: Diagnostic[] = [];
  const found: LocatedModule[] = [];
  for (const item of tree.root.items) {
    if (item.kind === 'ImportDeclaration' && item.path.kind === 'StringLiteral') {
      const located = locateImport(item.path, importer, loaders);
      if ('code' in located) {
        diagnostics.push(diagnosticIn(tree, located));
      } else {
        imports.set(item, located.id);
        found.push(located);
      }
    }
  }
  return { imports, diagnostics, found };
}

/** The one module a path names, or the diagnostic explaining why it names none or several. */
function locateImport(
  { span, value }: StringLiteral,
  importer: ModuleId,
  loaders: readonly ModuleLoader[],
): LocatedModule | Diagnostic<AnchoredSpan> {
  const answers = loaders.flatMap((load) => load(value, importer) ?? []);
  const distinct = answers.filter(
    (answer, index) => answers.findIndex(({ id }) => id === answer.id) === index,
  );
  const [only, ...others] = distinct;
  if (only === undefined) {
    return programDiagnostics.unresolvedImport(span, value);
  }
  if (others.length > 0) {
    const labels = distinct.map(({ label }) => label);
    return programDiagnostics.ambiguousImport(span, value, labels);
  }
  return only;
}
