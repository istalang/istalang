/**
 * The program an editor sees: the whole project, as `ista check` loads it, with the editor's open
 * documents over their files. An open document counts as a root too, so a file not saved yet, or
 * one outside the project, is still checked. A document that isn't a file (an unsaved buffer, a
 * std module shown read-only) is left to the features that need no program.
 *
 * Sources are found again on every build, so files made or deleted outside the editor are seen at
 * the next edit.
 */

import type { ProgramLoader } from '../language-service/workspace.ts';
import { fileOfModule } from '../project/file-loader.ts';
import { findProjectSources, loadProject } from '../project/project.ts';
import { overlaidFiles } from '../project/project-files.ts';

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
    return loadProject(root, roots, { files: overlaidFiles(texts), previous }).program;
  };
}
