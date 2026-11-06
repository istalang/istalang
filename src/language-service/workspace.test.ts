import { describe, expect, it } from 'vitest';
import { checkProgram } from '../compiler/checker/check.ts';
import { diagnoseModule } from '../compiler/compile.ts';
import { type Files, idOf, programOf } from '../compiler/program/program.test-kit.ts';
import type { Program } from '../compiler/program/program.ts';
import type { FunctionDeclaration } from '../compiler/syntax/declarations/index.ts';
import { stdlibLoader, stdRoles } from '../stdlib/stdlib-loader.ts';
import { memo } from '../structures/memo.ts';
import { completionsAt } from './completion/index.ts';
import { hoverAt } from './hover.ts';
import { type OpenTexts, Workspace } from './workspace.ts';

/** The program of `files`, with `open` laid over them, over the shipped std. */
function stdProgramOf(files: Files, open: OpenTexts, previous: Program | undefined): Program {
  const texts = Object.entries(files).map(([key, text]) => [key, open.get(idOf(key)) ?? text]);
  return programOf(Object.fromEntries(texts), {
    previous,
    roles: stdRoles(),
    loaders: [stdlibLoader()],
  });
}

/**
 * A workspace over `files` in memory, recording every program it is asked to load, every program
 * it makes a checker for, and the bodies each of those checkers checks itself.
 */
function workspaceOver(files: Files) {
  const loads: { readonly open: OpenTexts; readonly previous: Program | undefined }[] = [];
  const checked = new Map<Program, FunctionDeclaration[]>();
  const workspace = new Workspace(
    (open, previous) => {
      loads.push({ open, previous });
      return stdProgramOf(files, open, previous);
    },
    (program, previous) => {
      const bodies = memo(checked, program, () => [] as FunctionDeclaration[]);
      return checkProgram(program, {
        previous,
        observe: (table, key) => {
          if (table === 'bodies') {
            bodies.push(key as FunctionDeclaration);
          }
        },
      });
    },
  );
  return { workspace, loads, checked };
}

describe('a workspace', () => {
  it('loads its program once for every change, however often it is asked', () => {
    const { workspace, loads } = workspaceOver({ main: 'fn main() -> Int: 1\n' });
    expect(workspace.program).toBe(workspace.program);
    workspace.write(idOf('main'), 'fn main() -> Int: 2\n');
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
    const { workspace } = workspaceOver({ main: 'fn main() -> Int: 1\n' });
    workspace.write(idOf('main'), 'fn main() -> Int: "one"\n');
    expect(workspace.diagnosticsOf(idOf('main'))?.diagnostics).toHaveLength(1);
    workspace.close(idOf('main'));
    expect(workspace.diagnosticsOf(idOf('main'))?.diagnostics).toEqual([]);
    expect(workspace.openModules).toEqual([]);
  });

  it('keeps its program when a document is written with the text it has', () => {
    const { workspace, loads } = workspaceOver({ main: 'fn main() -> Int: 1\n' });
    workspace.write(idOf('main'), 'fn main() -> Int: 1\n');
    const first = workspace.program;
    workspace.write(idOf('main'), 'fn main() -> Int: 1\n');
    expect(workspace.program).toBe(first);
    expect(loads).toHaveLength(1);
  });

  it('parses an open document the program lacks on its own, once for each text', () => {
    const { workspace } = workspaceOver({ main: '' });
    const untitled = idOf('untitled');
    expect(workspace.treeOf(untitled)).toBeUndefined();
    workspace.write(untitled, 'struct Pair:\n  first: Int\n');
    expect(workspace.treeOf(untitled)).toBe(workspace.treeOf(untitled));
    expect(workspace.treeOf(untitled)?.root.items.map((item) => item.kind)).toEqual([
      'StructDeclaration',
    ]);
    expect(workspace.diagnosticsOf(untitled)).toBeUndefined();
  });

  describe('checking a burst of edits', () => {
    const main = idOf('main');
    const files = {
      main: 'fn f() -> Int: 1 + 0\n\nfn g() -> Int: f() * 3\n\nfn h(x: Int) -> Int: "x"\n',
    };
    const edited = (digit: number) => files.main.replace('1 + 0', `1 + ${digit}`);
    const bodyOffset = files.main.indexOf('1 + 0');

    it('re-checks only the edited body, with features asked between the edits', () => {
      const { workspace, checked } = workspaceOver(files);
      workspace.diagnosticsOf(main);
      const checkedBefore = new Set(checked.get(workspace.program));
      for (const digit of [1, 2, 3]) {
        workspace.write(main, edited(digit));
        workspace.treeOf(main);
        hoverAt(workspace.program, main, bodyOffset);
        completionsAt(workspace.program, main, bodyOffset);
      }
      const diagnosed = workspace.diagnosticsOf(main);
      const last = workspace.program;
      const declarations = last.modules.get(main)?.tree.root.items;
      // A body no checker had checked yet, such as a std function's whose result completion shows,
      // is checked once.
      const rechecked = checked
        .get(last)
        ?.filter((body) => checkedBefore.has(body) || body === declarations?.[0]);
      expect(rechecked).toEqual([declarations?.[0]]);
      const fresh = stdProgramOf(files, new Map([[main, edited(3)]]), undefined);
      expect(diagnosed?.diagnostics).toEqual(diagnoseModule(fresh, main).diagnostics);
      expect(diagnosed?.diagnostics).toHaveLength(1);
    });

    it('makes no checker for a query that reads syntax alone', () => {
      const { workspace, checked } = workspaceOver(files);
      workspace.diagnosticsOf(main);
      workspace.write(main, edited(1));
      const tree = workspace.treeOf(main);
      expect(checked).toHaveLength(1);
      expect(workspace.program.modules.get(main)?.tree).toBe(tree);
      expect(checked).toHaveLength(2);
    });
  });
});
