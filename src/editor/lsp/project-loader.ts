/**
 * The program an editor sees: the whole project, as `ista check` loads it, with the editor's open
 * documents over their files. An open document counts as a root too, so a file not saved yet, or
 * one outside the project, is still checked.
 *
 * - An unsaved buffer (VS Code's `untitled:` documents) is a root of its own, a module no file
 *   holds and no import path names (its name is empty): its imports name modules from the
 *   project root, as it has no folder to climb from.
 * - Any other document that isn't a file (a std module shown read-only) is left to the features
 *   that need no program, as the program holds that module under its own id already.
 *
 * Sources are found again on every build, so files made or deleted outside the editor are seen at
 * the next edit.
 */

import type { LocatedModule, ModuleId } from '../../compiler/program/program.ts';
import { fileOfModule } from '../../project/file-loader.ts';
import { findProjectSources, loadProject } from '../../project/project.ts';
import { overlaidFiles } from '../../project/project-files.ts';
import type { OpenTexts, ProgramLoader } from '../language-service/workspace.ts';

/** The loader of the project at `root`. */
export function projectProgramLoader(root: string): ProgramLoader {
  return (open, previous) => {
    const texts = new Map(
      [...open].flatMap(([module, text]) => {
        const file = fileOfModule(module);
        return file === undefined ? [] : [[file, text] as const];
      }),
    );
    const roots = [...findProjectSources(root), ...texts.keys()];
    const files = overlaidFiles(texts);
    return loadProject(root, roots, { files, previous, buffers: unsavedBuffers(open) }).program;
  };
}

/** The scheme of an editor's documents not saved to a file yet. */
const unsavedScheme = 'untitled:';

/** The open documents that are unsaved buffers, as modules of their own. */
function unsavedBuffers(open: OpenTexts): readonly LocatedModule[] {
  return [...open].flatMap(([id, text]) =>
    id.startsWith(unsavedScheme) ? [buffer(id, text)] : [],
  );
}

function buffer(id: ModuleId, text: string): LocatedModule {
  return { id, name: '', label: id, read: () => text };
}
