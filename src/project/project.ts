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
import { join, resolve } from 'node:path';
import { buildProgram, type LocatedModule, type Program } from '../compiler/program/program.ts';
import { type StdSources, stdlibLoader, stdRoles } from '../stdlib/stdlib-loader.ts';
import { fileLoader, locateFile, sourceExtension } from './file-loader.ts';
import { diskFiles, type ProjectFiles, statOnDisk } from './project-files.ts';

/**
 * Never project sources: dependencies at any depth, and the project's vendored packages (§11).
 * Hidden directories are skipped by the glob itself.
 */
const excludedDirectories = ['**/node_modules', 'vendor'];

/** Every source file under the project root, sorted. */
export function findProjectSources(cwd: string): readonly string[] {
  return findSources(cwd, sourceExtension);
}

/** A walk of a directory for one suffix: what it found, and each directory it went through. */
interface Scan {
  readonly sources: readonly string[];
  /** Every directory walked, the scanned one included, by absolute path, with its mtime then. */
  readonly directories: ReadonlyMap<string, number>;
}

/**
 * How old every mtime a scan read must be for the scan to be kept: the coarsest file system
 * timestamp (FAT's two seconds). A change in the same tick as one made just before the scan would
 * keep the mtime the scan read, and go unseen.
 */
const settledMilliseconds = 2000;

/**
 * The last scan of each directory for each suffix, kept while it holds. An entry is created,
 * removed or renamed only through its directory, which takes a new mtime, so a scan holds while
 * every directory it walked keeps the mtime it had: an editor building at every keystroke stats a
 * few directories rather than walking the tree.
 */
const keptScans = new Map<string, Scan>();

/** Every file under `directory` whose name ends in `suffix`, skipping what is never a source, sorted. */
export function findSources(directory: string, suffix: string): readonly string[] {
  const root = resolve(directory);
  const key = `${suffix}\0${root}`;
  const kept = keptScans.get(key);
  if (kept !== undefined && holds(kept)) {
    return kept.sources;
  }
  const startedAt = Date.now();
  const scan = scanned(root, suffix);
  const settled =
    scan.directories.has(root) &&
    [...scan.directories.values()].every((mtime) => mtime < startedAt - settledMilliseconds);
  if (settled) {
    keptScans.set(key, scan);
  } else {
    keptScans.delete(key);
  }
  return scan.sources;
}

/**
 * One walk for the sources and the directories alike. Any name ending in `suffix` is a source,
 * a directory's too, which then is reported where a root names no file.
 */
function scanned(root: string, suffix: string): Scan {
  const entries = globSync([`**/*${suffix}`, '**/'], {
    cwd: root,
    exclude: excludedDirectories,
    withFileTypes: true,
  }).map((entry) => ({ entry, path: join(entry.parentPath, entry.name) }));
  const directories = new Map<string, number>();
  for (const { entry, path } of entries) {
    const mtime = entry.isFile() ? undefined : mtimeOf(path);
    if (mtime !== undefined) {
      directories.set(path, mtime);
    }
  }
  const sources = entries.flatMap(({ entry, path }) =>
    path !== root && entry.name.endsWith(suffix) ? [path] : [],
  );
  return { sources: sources.sort(), directories };
}

/** Whether every directory `scan` walked keeps the mtime it had. */
function holds(scan: Scan): boolean {
  return [...scan.directories].every(([path, mtime]) => mtimeOf(path) === mtime);
}

/** The mtime of the directory at `path`, through a link; `undefined` when it is no directory now. */
function mtimeOf(path: string): number | undefined {
  const stat = statOnDisk(path);
  return stat?.isDirectory() ? stat.mtimeMs : undefined;
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
