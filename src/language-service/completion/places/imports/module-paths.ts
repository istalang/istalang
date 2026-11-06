/**
 * The module paths an import's path may go on with (§3.13), one name at a time: the modules in the
 * folder written so far, and the folders holding more, named with their `/`, so a folder never
 * reads as a module of its name and accepting one goes on to the modules inside. Text out of the
 * path syntax (language/import-paths.ts) goes on with nothing.
 *
 * A module's canonical name is its path from the project root (program.ts), so the folder is found
 * among the project's modules by name: from the root, or for a relative path from the importer's
 * folder, which can't climb above the root, where no project module is. The editor loads every
 * project file into the program, so the program's modules are the project's; a module no path
 * names (an editor's unsaved buffer, of an empty name) is none, and has no folder to climb from.
 * Std modules have one-name paths and no folders; `testing` is a test module's alone (§10).
 */

import {
  type ModuleId,
  type Program,
  programModule,
} from '../../../../compiler/program/program.ts';
import { importPathOf } from '../../../../language/import-paths.ts';
import { languageModules } from '../../../../language/well-known/index.ts';
import type { Candidate } from '../../candidate.ts';
import type { Cursor } from '../../cursor.ts';

/** The paths going on from `written`, the path's text before the cursor. */
export function modulePathsAt(
  { checker: { program }, module, stdModules }: Cursor,
  written: string,
): readonly Candidate[] {
  const slash = written.lastIndexOf('/');
  const importer = programModule(program, module);
  const folder = slash === -1 ? [] : folderOf(written.slice(0, slash), importer.name);
  if (folder === undefined) {
    return [];
  }
  const segments = new Map<string, Candidate>();
  for (const path of projectPaths(program, module)) {
    if (path.length > folder.length && folder.every((name, index) => path[index] === name)) {
      const to = path.length === folder.length + 1 ? 'module' : 'folder';
      const segment = path[folder.length] ?? '';
      const name = to === 'module' ? segment : `${segment}/`;
      segments.set(name, { name, subject: { kind: 'modulePath', to } });
    }
  }
  const std = slash === -1 ? stdModules.filter((name) => importer.isTest || name !== testing) : [];
  return [
    ...std.map((name): Candidate => ({ name, subject: { kind: 'modulePath', to: 'module' } })),
    ...segments.values(),
  ];
}

const { testing } = languageModules;

/** The names, from the project root, of the folder `text` writes in the module named `importer`. */
function folderOf(text: string, importer: string): readonly string[] | undefined {
  const path = importPathOf(text);
  if (path === undefined || path.climbs.length === 0) {
    return path?.names;
  }
  if (importer === '') {
    return undefined;
  }
  const folder = importer.split('/').slice(0, -1);
  for (const climb of path.climbs) {
    if (climb === '..' && folder.pop() === undefined) {
      return undefined;
    }
  }
  return [...folder, ...path.names];
}

/** The paths from the project root, as names, of the project's modules but `importer`. */
function projectPaths(program: Program, importer: ModuleId): readonly (readonly string[])[] {
  return [...program.modules.values()].flatMap(({ id, isStd, name }) =>
    isStd || id === importer || name === '' ? [] : [name.split('/')],
  );
}
