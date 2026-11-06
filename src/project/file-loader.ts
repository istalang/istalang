/**
 * Loads the project's modules from disk, for import paths in the toolchain's syntax (§3.13,
 * foundation/language/import-paths.ts): one starting with `./` or `../` goes from the importing
 * file, any other from the project root, and a path out of that syntax names no file here. A
 * module's id is its file's URL, so every path that reaches one file names one module.
 *
 * Locating a file only checks that it is there; the loading core reads it once, when it loads the
 * module. A path to nothing, or to a directory, is simply not a module. Any other error is the
 * system refusing, and propagates for the app to report. Which files are there, and what they hold,
 * is the files seam's (project-files.ts): the disk, or open documents over it. A module's label is its path relative to
 * the working directory, which is how diagnostics show it; its name is its path from the project
 * root in this same syntax, which never depends on where `ista` runs.
 */

import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type LocatedModule,
  type ModuleId,
  type ModuleLoader,
  moduleIdOf,
} from '../compiler/program/program.ts';
import { importPathOf } from '../foundation/language/import-paths.ts';
import { isTestModulePath } from '../foundation/language/well-known/testing.ts';
import { diskFiles, type ProjectFiles } from './project-files.ts';

export const sourceExtension = '.ista';

/** Where the project is, and where the toolchain runs, which labels are relative to. */
export interface ProjectPlaces {
  readonly projectRoot: string;
  readonly cwd: string;
}

/** The loader of the project's `files`. */
export function fileLoader(places: ProjectPlaces, files: ProjectFiles = diskFiles): ModuleLoader {
  return (path, importer) => {
    const file = filePathOf(path, importer, places.projectRoot);
    return file === undefined ? undefined : locateFile(file, places, files);
  };
}

/** The module in `file`, an absolute path; `undefined` when `files` has no such file. */
export function locateFile(
  file: string,
  places: ProjectPlaces,
  files: ProjectFiles = diskFiles,
): LocatedModule | undefined {
  if (!files.isFile(file)) {
    return;
  }
  return {
    id: moduleIdOfFile(file),
    name: withoutExtension(relative(places.projectRoot, file).split(sep).join('/')),
    label: relative(places.cwd, file),
    isTest: isTestModulePath(file),
    read: () => files.read(file),
  };
}

/** The id of the module in `file`, an absolute path: its file's URL. */
export function moduleIdOfFile(file: string): ModuleId {
  return moduleIdOf(pathToFileURL(file));
}

/** The file holding the module `id`, an absolute path; `undefined` for a module that isn't a file. */
export function fileOfModule(id: ModuleId): string | undefined {
  return id.startsWith('file:') ? fileURLToPath(id) : undefined;
}

/** The file a path names, or `undefined` when it isn't in the toolchain's syntax. */
function filePathOf(path: string, importer: ModuleId, projectRoot: string): string | undefined {
  const read = importPathOf(path);
  if (read === undefined || read.names.length === 0) {
    return;
  }
  const { climbs, names } = read;
  const base = climbs.length === 0 ? projectRoot : directoryOf(importer);
  return base === undefined ? undefined : `${resolve(base, ...climbs, ...names)}${sourceExtension}`;
}

/** The directory of a module on disk; `undefined` for a module that isn't a file. */
function directoryOf(id: ModuleId): string | undefined {
  const file = fileOfModule(id);
  return file === undefined ? undefined : dirname(file);
}

/** A path as an import names it: without the `.ista` it implies. A root may lack it. */
function withoutExtension(path: string): string {
  return path.endsWith(sourceExtension) ? path.slice(0, -sourceExtension.length) : path;
}
