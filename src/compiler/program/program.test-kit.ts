/**
 * Programs over in-memory modules, for the tests of every phase that starts from a program.
 *
 * The loader here is deliberately trivial: an import's path is the module's key, verbatim, so these
 * tests depend on the loading core alone and on no loader's path syntax. Each source is named and
 * labelled with its key, so diagnostics and assertions read as the files they come from.
 */

import { isTestModulePath } from '../../language/well-known/testing.ts';
import type { Span } from '../../text/span.ts';
import { type AnchoredSpan, spanIn } from '../syntax/positions.ts';
import {
  buildProgram,
  type LocatedModule,
  type ModuleId,
  type ModuleLoader,
  moduleIdOf,
  type Program,
  type ProgramModule,
  type ProgramOptions,
  programModule,
} from './program.ts';

export type Files = Readonly<Record<string, string>>;

/** The id of the in-memory module `key`. */
export function idOf(key: string): ModuleId {
  return moduleIdOf(new URL(`memory:${encodeURIComponent(key)}`));
}

/** A loader serving `files`, where an import's path is a key of `files`. */
export function memoryLoader(files: Files): ModuleLoader {
  const modules = new Map<string, LocatedModule>(
    Object.entries(files).map(([key, text]) => [
      key,
      {
        id: idOf(key),
        name: key,
        label: key,
        isTest: isTestModulePath(key),
        read: () => text,
      },
    ]),
  );
  return (path) => modules.get(path);
}

export interface ProgramOfOptions {
  /** The keys to start from; the first file by default. */
  readonly roots?: readonly string[] | undefined;
  /** The snapshot whose unchanged trees the new one reuses. */
  readonly previous?: Program | undefined;
  readonly roles?: ProgramOptions['roles'];
  /** Loaders asked after the in-memory one, such as the std modules'. */
  readonly loaders?: readonly ModuleLoader[] | undefined;
}

/** The program over `files`, loaded from `roots`. */
export function programOf(
  files: Files,
  { roots = Object.keys(files).slice(0, 1), previous, roles, loaders = [] }: ProgramOfOptions = {},
): Program {
  const load = memoryLoader(files);
  const anywhere = idOf('');
  const located = roots.flatMap((key) => load(key, anywhere) ?? []);
  return buildProgram(
    { roots: located, loaders: [load, ...loaders], ...(roles === undefined ? {} : { roles }) },
    previous,
  );
}

/** The loaded module `key`; throws when the program didn't load it. */
export function moduleAt(program: Program, key: string): ProgramModule {
  const module = program.modules.get(idOf(key));
  if (module === undefined) {
    throw new Error(`${key} is not in the program`);
  }
  return module;
}

/** Where `node`, a node of `module`, stands in that module's text. */
export function textSpanOf(
  program: Program,
  module: ModuleId,
  node: { readonly span: AnchoredSpan },
): Span {
  return spanIn(programModule(program, module).tree, node.span);
}

/** The keys of the loaded modules, in load order. */
export function loadedPaths(program: Program): readonly string[] {
  return [...program.modules.values()].map((module) => module.tree.source.path);
}
