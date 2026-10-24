/**
 * Programs over in-memory modules, for the tests of every phase that starts from a program.
 *
 * The loader here is deliberately trivial: an import's path is the module's key, verbatim, so these
 * tests depend on the loading core alone and on no loader's path syntax. Each source is named and
 * labelled with its key, so diagnostics and assertions read as the files they come from.
 */

import {
  buildProgram,
  type LocatedModule,
  type ModuleId,
  type ModuleLoader,
  moduleIdOf,
  type Program,
  type ProgramModule,
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
      { id: idOf(key), name: key, label: key, read: () => text },
    ]),
  );
  return (path) => modules.get(path);
}

export interface ProgramOfOptions {
  /** The keys to start from; the first file by default. */
  readonly roots?: readonly string[] | undefined;
  /** The snapshot whose unchanged trees the new one reuses. */
  readonly previous?: Program | undefined;
  readonly prelude?: LocatedModule | undefined;
}

/** The program over `files`, loaded from `roots`. */
export function programOf(
  files: Files,
  { roots = Object.keys(files).slice(0, 1), previous, prelude }: ProgramOfOptions = {},
): Program {
  const load = memoryLoader(files);
  const anywhere = idOf('');
  const located = roots.flatMap((key) => load(key, anywhere) ?? []);
  const withPrelude = prelude === undefined ? {} : { prelude };
  return buildProgram({ roots: located, loaders: [load], ...withPrelude }, previous);
}

/** The loaded module `key`; throws when the program didn't load it. */
export function moduleAt(program: Program, key: string): ProgramModule {
  const module = program.modules.get(idOf(key));
  if (module === undefined) {
    throw new Error(`${key} is not in the program`);
  }
  return module;
}

/** The keys of the loaded modules, in load order. */
export function loadedPaths(program: Program): readonly string[] {
  return [...program.modules.values()].map((module) => module.tree.source.path);
}
