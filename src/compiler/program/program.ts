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
 *   unchanged, by identity. Everything derived per tree (bindings, types) is memoized on that
 *   identity, so an edit re-derives only what it touched, and no cache is invalidated by hand.
 * - Loading, meaning scanning, parsing and resolving, belongs here: discovering a module's imports
 *   needs its tree. The coordinator (compile.ts) takes over from a Program.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { LanguageModule } from '../../language/well-known.ts';
import { createSourceText, type SourceText } from '../../text/source-text.ts';
import { parse } from '../parser/parse.ts';
import { scan } from '../scanner/scan.ts';
import type { ImportDeclaration } from '../syntax/declarations.ts';
import type { StringLiteral } from '../syntax/expressions.ts';
import type { SyntaxTree } from '../syntax/tree.ts';
import { programDiagnostics } from './diagnostics.ts';

declare const isModuleUrl: unique symbol;

/** A module's identity: the URL of its source, such as `file:///app/purchase/approve.ista`. */
export type ModuleId = string & { readonly [isModuleUrl]: true };

/** The id of the module whose source is at `url`. */
export function moduleIdOf(url: URL): ModuleId {
  return url.href as ModuleId;
}

/** A module a loader found, not yet read. */
export interface LocatedModule {
  readonly id: ModuleId;
  /**
   * The module's canonical name, which compiled code qualifies its declarations with: the import
   * path that names it from anywhere (§3.13), such as `purchase/approve` or `time`. Unlike the
   * label it never depends on where the toolchain runs, so a compiled program's identity doesn't.
   */
  readonly name: string;
  /** How diagnostics name the module, such as its path from the working directory. */
  readonly label: string;
  /** Whether the toolchain ships the module (§3.8): its externs are the runtime's, not a host's. */
  readonly isStd?: boolean;
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
  readonly tree: SyntaxTree;
  /** The module each import names, for every import that names exactly one. */
  readonly imports: ReadonlyMap<ImportDeclaration, ModuleId>;
  /** Problems loading this module's imports; the tree carries the syntax diagnostics. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface Program {
  readonly roots: readonly ModuleId[];
  /** The std modules the language refers to (language/well-known.ts), as the app supplied them. */
  readonly roles: Readonly<Partial<Record<LanguageModule, ModuleId>>>;
  /** Every module reachable from the roots, in load order. */
  readonly modules: ReadonlyMap<ModuleId, ProgramModule>;
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
   * makes visible everywhere, and `time`, which types duration literals but is visible only where
   * imported.
   */
  readonly roles?: Readonly<Partial<Record<LanguageModule, LocatedModule>>>;
}

/** Loads the modules reachable from the roots, reusing unchanged trees from `previous`. */
export function buildProgram(options: ProgramOptions, previous?: Program): Program {
  const modules = new Map<ModuleId, ProgramModule>();
  const roles = Object.entries(options.roles ?? {});
  const queue = [...options.roots, ...roles.map(([, module]) => module)];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { id, name, label, read, isStd = false } = next;
    if (!modules.has(id)) {
      const source = createSourceText(label, read());
      const tree = reusableTree(previous?.modules.get(id)?.tree, source) ?? parseSource(source);
      const { imports, diagnostics, found } = resolveImports(tree, id, options.loaders);
      modules.set(id, { id, name, isStd, tree, imports, diagnostics });
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

function parseSource(source: SourceText): SyntaxTree {
  return parse(source, scan(source));
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
    const isImport = item.kind === 'NamedImport' || item.kind === 'NamespaceImport';
    if (isImport && item.path.kind === 'StringLiteral') {
      const located = locateImport(item.path, importer, loaders);
      if ('code' in located) {
        diagnostics.push(located);
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
): LocatedModule | Diagnostic {
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
