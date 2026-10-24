/**
 * Loads the project's modules from disk, for import paths in the toolchain's syntax (§3.13).
 *
 * A path is names separated by `/`, with the `.ista` extension implied. One starting with `./` or
 * `../` goes from the importing file; any other goes from the project root. Anything else (an
 * empty name, a `.` or `..` after a name, an absolute path, a URL) names no file here. A name may
 * not hold `\` or `:` either, which some platforms read as separators or drive letters, so a path
 * can't escape its base. A module's id is its file's URL, so every path that reaches one file
 * names one module.
 *
 * Locating a file only checks that it is there; the loading core reads it once, when it loads the
 * module. A path to nothing, or to a directory, is simply not a module. Any other error is the
 * system refusing, and propagates for the CLI to report. A module's label is its path relative to
 * the working directory, which is how diagnostics show it.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type LocatedModule,
  type ModuleId,
  type ModuleLoader,
  moduleIdOf,
} from '../compiler/program/program.ts';

export const sourceExtension = '.ista';

const platformSeparator = /[\\:]/u;

/** The loader of the project's files under `projectRoot`, labelling them relative to `cwd`. */
export function fileLoader(projectRoot: string, cwd: string): ModuleLoader {
  return (path, importer) => {
    const file = filePathOf(path, importer, projectRoot);
    return file === undefined ? undefined : locateFile(file, cwd);
  };
}

/** The module in `file`, an absolute path; `undefined` when there is no such file. */
export function locateFile(file: string, cwd: string): LocatedModule | undefined {
  if (!isFile(file)) {
    return;
  }
  const id = moduleIdOf(pathToFileURL(file));
  return { id, label: relative(cwd, file), read: () => readFileSync(file, 'utf8') };
}

function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch (error) {
    if (isAbsentFile(error)) {
      return false;
    }
    throw error;
  }
}

/** The file a path names, or `undefined` when it isn't in the toolchain's syntax. */
function filePathOf(path: string, importer: ModuleId, projectRoot: string): string | undefined {
  const parts = path.split('/');
  const leading = parts.findIndex((part) => part !== '.' && part !== '..');
  const names = parts.slice(leading);
  const isName = (part: string): boolean =>
    part !== '' && part !== '.' && part !== '..' && !platformSeparator.test(part);
  if (leading === -1 || !names.every(isName)) {
    return;
  }
  const base = leading === 0 ? projectRoot : directoryOf(importer);
  const climbs = parts.slice(0, leading);
  return base === undefined ? undefined : `${resolve(base, ...climbs, ...names)}${sourceExtension}`;
}

/** The directory of a module on disk; `undefined` for a module that isn't a file. */
function directoryOf(id: ModuleId): string | undefined {
  return id.startsWith('file:') ? dirname(fileURLToPath(id)) : undefined;
}

const absentFileCodes = new Set(['ENOTDIR']);

function isAbsentFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && absentFileCodes.has(String(error.code));
}
