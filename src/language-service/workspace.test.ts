import { describe, expect, it } from 'vitest';
import { type Files, idOf, programOf } from '../compiler/program/program.test-kit.ts';
import type { Program } from '../compiler/program/program.ts';
import { stdlibLoader, stdRoles } from '../stdlib/stdlib-loader.ts';
import { type OpenTexts, Workspace } from './workspace.ts';

/** A workspace over `files` in memory, recording every program it is asked to load. */
function workspaceOver(files: Files) {
  const loads: { readonly open: OpenTexts; readonly previous: Program | undefined }[] = [];
  const workspace = new Workspace((open, previous) => {
    loads.push({ open, previous });
    const texts = Object.entries(files).map(([key, text]) => [key, open.get(idOf(key)) ?? text]);
    return programOf(Object.fromEntries(texts), {
      previous,
      roles: stdRoles(),
      loaders: [stdlibLoader()],
    });
  });
  return { workspace, loads };
}

describe('a workspace', () => {
  it('loads its program once for every change, however often it is asked', () => {
    const { workspace, loads } = workspaceOver({ main: 'fn main() -> int: 1\n' });
    expect(workspace.program).toBe(workspace.program);
    workspace.write(idOf('main'), 'fn main() -> int: 2\n');
    expect(workspace.program).toBe(workspace.program);
    expect(loads).toHaveLength(2);
  });

  it('hands each load the program before it, whose unchanged trees it reuses', () => {
    const { workspace, loads } = workspaceOver({
      main: "import f from 'lib'\n",
      lib: 'fn f(): 1\n',
    });
    const first = workspace.program;
    workspace.write(idOf('main'), "import f from 'lib'\n\nfn g(): f()\n");
    const second = workspace.program;
    expect(loads.at(-1)?.previous).toBe(first);
    expect(second.modules.get(idOf('lib'))?.tree).toBe(first.modules.get(idOf('lib'))?.tree);
  });

  it('serves the open text of a document, and its file once it closes', () => {
    const { workspace } = workspaceOver({ main: 'fn main() -> int: 1\n' });
    workspace.write(idOf('main'), 'fn main() -> int: "one"\n');
    expect(workspace.diagnosticsOf(idOf('main'))?.diagnostics).toHaveLength(1);
    workspace.close(idOf('main'));
    expect(workspace.diagnosticsOf(idOf('main'))?.diagnostics).toEqual([]);
    expect(workspace.openModules).toEqual([]);
  });

  it('keeps its program when a document is written with the text it has', () => {
    const { workspace, loads } = workspaceOver({ main: 'fn main() -> int: 1\n' });
    workspace.write(idOf('main'), 'fn main() -> int: 1\n');
    const first = workspace.program;
    workspace.write(idOf('main'), 'fn main() -> int: 1\n');
    expect(workspace.program).toBe(first);
    expect(loads).toHaveLength(1);
  });

  it('parses an open document the program lacks on its own, once for each text', () => {
    const { workspace } = workspaceOver({ main: '' });
    const untitled = idOf('untitled');
    expect(workspace.treeOf(untitled)).toBeUndefined();
    workspace.write(untitled, 'struct Pair:\n  first: int\n');
    expect(workspace.treeOf(untitled)).toBe(workspace.treeOf(untitled));
    expect(workspace.treeOf(untitled)?.root.items.map((item) => item.kind)).toEqual([
      'StructDeclaration',
    ]);
    expect(workspace.diagnosticsOf(untitled)).toBeUndefined();
  });
});
