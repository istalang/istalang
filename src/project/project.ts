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
import { buildProgram, type LocatedModule, type Program } from '../compiler/program/program.ts';
import { type StdSources, stdlibLoader, stdRoles } from '../stdlib/stdlib-loader.ts';
import { fileLoader, locateFile, sourceExtension } from './file-loader.ts';
import { diskFiles, type ProjectFiles } from './project-files.ts';

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
  /** The given paths that name no file, as given. */
  readonly unreadable: readonly string[];
}

export interface ProjectOptions {
  /** Where the project's texts come from: the disk, unless an editor lays its documents over it. */
  readonly files?: ProjectFiles;
  /** Std module sources in place of the shipped ones, for the loader and the roles alike. */
  readonly std?: StdSources;
  /** The program last loaded, whose unchanged trees the new one reuses: an editor's snapshot. */
  readonly previous?: Program | undefined;
  /** Roots no file holds, such as an editor's unsaved buffers, loaded beside the paths. */
  readonly buffers?: readonly LocatedModule[];
}

/** The program rooted at the files at `paths`, with the std modules. */
export function loadProject(
  cwd: string,
  paths: readonly string[],
  { files = diskFiles, std, previous, buffers = [] }: ProjectOptions = {},
): Project {
  const places = { projectRoot: cwd, cwd };
  const roots = paths.map((path) => ({
    path,
    module: locateFile(resolve(cwd, path), places, files),
  }));
  const program = buildProgram(
    {
      roots: [...roots.flatMap(({ module }) => module ?? []), ...buffers],
      loaders: [fileLoader(places, files), stdlibLoader(std)],
      roles: stdRoles(std),
    },
    previous,
  );
  return { program, unreadable: roots.filter(({ module }) => !module).map(({ path }) => path) };
}
