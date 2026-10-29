/**
 * A project on disk as the apps see it: source files under the directory the toolchain runs in,
 * which is also the project root.
 *
 * Every app that compiles (each CLI command, the language server) loads its program here, so they
 * all agree on where sources are and on which loaders apply: the project's files and the std
 * modules, with the prelude (§3.13). The roots an app names are read with the same file loader its
 * imports use, so "no such file" has one meaning.
 */

import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProgram, type ModuleLoader, type Program } from '../compiler/program/program.ts';
import { stdlibLoader, stdRoles } from '../stdlib/stdlib-loader.ts';
import { fileLoader, locateFile, sourceExtension } from './file-loader.ts';

/**
 * Never project sources: dependencies at any depth, and the project's vendored packages (§11).
 * Hidden directories are skipped by the glob itself.
 */
const excludedDirectories = ['**/node_modules', 'vendor'];

/** Every source file under the project root, sorted. */
export function findProjectSources(cwd: string): readonly string[] {
  return findSources(cwd, sourceExtension);
}

/** Every file under `directory` whose name ends in `suffix`, skipping what is never a source, sorted. */
export function findSources(directory: string, suffix: string): readonly string[] {
  return globSync(`**/*${suffix}`, { cwd: directory, exclude: excludedDirectories })
    .map((path) => resolve(directory, path))
    .sort();
}

export interface Project {
  readonly program: Program;
  /** The given files that could not be read, as given. */
  readonly unreadable: readonly string[];
}

/** The program rooted at the given files, read from disk, with `std` for the std modules. */
export function loadProject(
  cwd: string,
  files: readonly string[],
  std: ModuleLoader = stdlibLoader(),
): Project {
  const places = { projectRoot: cwd, cwd };
  const roots = files.map((file) => ({ file, module: locateFile(resolve(cwd, file), places) }));
  const program = buildProgram({
    roots: roots.flatMap(({ module }) => module ?? []),
    loaders: [fileLoader(places), std],
    roles: stdRoles(),
  });
  return { program, unreadable: roots.filter(({ module }) => !module).map(({ file }) => file) };
}
