/**
 * The program an editor sees, over a project on disk: an unsaved buffer is a module of its own,
 * which no import path names, so completion never offers it as a path, and from which no relative
 * path climbs.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModuleId } from '../../compiler/program/program.ts';
import { moduleIdOfFile } from '../../project/file-loader.ts';
import { tempProject } from '../../project/project.test-kit.ts';
import { completionsAt } from '../language-service/completion/index.ts';
import { projectProgramLoader } from './project-loader.ts';

const cursor = '‸';
const buffer = 'untitled:Untitled-1' as ModuleId;

/** The paths offered at the `‸` of `marked`, open as `module` beside the other `open` texts. */
function pathsAt(
  root: string,
  module: ModuleId,
  marked: string,
  open: ReadonlyMap<ModuleId, string>,
): readonly string[] {
  const offset = marked.indexOf(cursor);
  const text = marked.replace(cursor, '');
  const program = projectProgramLoader(root)(new Map(open).set(module, text), undefined);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

describe('an unsaved buffer', () => {
  it("is no path a project file's import may name", () => {
    const root = tempProject({ 'lib.ista': 'fn one() -> Int: 1\n', 'main.ista': '' });
    const main = moduleIdOfFile(join(root, 'main.ista'));
    const open = new Map([[buffer, 'fn two() -> Int: 2\n']]);
    const offered = pathsAt(root, main, "import x from '‸'\n", open);
    expect(offered).toContain('lib');
    expect(offered).not.toContain('Untitled-1');
  });

  it('names the project root, never a relative folder, in its own imports', () => {
    const root = tempProject({ 'lib.ista': 'fn one() -> Int: 1\n' });
    expect(pathsAt(root, buffer, "import x from '‸'\n", new Map())).toContain('lib');
    expect(pathsAt(root, buffer, "import x from './‸'\n", new Map())).toEqual([]);
  });
});
