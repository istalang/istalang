/**
 * The apps' composition of loaders on a real project: what an app's roots and imports load from,
 * open documents laid over the disk, and the one rule that spans loaders, that a path naming both
 * a std module and a project file is ambiguous. Finding a project's sources again, after any
 * edit of its tree, finds what walking it afresh finds.
 */

import { globSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { programDiagnostics } from '../compiler/program/diagnostics.ts';
import { moduleIdOf, type Program } from '../compiler/program/program.ts';
import { tempProject } from './project.test-kit.ts';
import { findProjectSources, loadProject } from './project.ts';
import { overlaidFiles } from './project-files.ts';

describe('loadProject', () => {
  it('reports a bare path that names both a std module and a project file, naming both', () => {
    const root = tempProject({ 'main.ista': "import * as time from 'time'\n", 'time.ista': '' });
    const { program } = loadProject(root, ['main.ista'], { std: { time: '' } });
    const [main] = program.modules.values();
    expect(main?.diagnostics.map(({ code }) => code)).toEqual([
      programDiagnostics.ambiguousImport.code,
    ]);
    expect(main?.diagnostics[0]?.message).toContain('std:time');
    expect(main?.diagnostics[0]?.message).toContain('time.ista');
  });

  it('loads a std module when no project file claims its name', () => {
    const root = tempProject({ 'main.ista': "import * as time from 'time'\n" });
    const { program } = loadProject(root, ['main.ista'], { std: { time: 'fn now(): 1' } });
    expect([...program.modules.values()].map(({ tree }) => tree.source.path)).toEqual([
      'main.ista',
      'std:prelude',
      'std:time',
      'std:json',
      'std:testing',
    ]);
    expect(textOf(program, 'time')).toBe('fn now(): 1');
    expect(textOf(program, 'prelude')).not.toBe('');
  });

  it('serves open documents in place of their files, and before they are saved', () => {
    const root = tempProject({
      'main.ista': "import * as lib from 'lib'\n",
      'lib.ista': 'fn a(): 1',
    });
    const open = new Map([
      [join(root, 'lib.ista'), 'fn a(): 2'],
      [join(root, 'draft.ista'), 'fn d(): 3'],
    ]);
    const files = overlaidFiles(open);
    const { program, unreadable } = loadProject(root, ['main.ista', 'draft.ista'], { files });
    expect(unreadable).toEqual([]);
    expect(textOf(program, 'lib')).toBe('fn a(): 2');
    expect(textOf(program, 'draft')).toBe('fn d(): 3');
    const lib = moduleIdOf(pathToFileURL(join(root, 'lib.ista')));
    expect(program.modules.get(lib)?.name).toBe('lib');
  });

  it('loads the prelude, time, json and testing with every program, by their roles, and what they import', () => {
    const root = tempProject({ 'main.ista': '' });
    const { program } = loadProject(root, ['main.ista']);
    expect(program.roles).toEqual({
      prelude: 'std:prelude',
      time: 'std:time',
      json: 'std:json',
      testing: 'std:testing',
    });
    const shipped = [...program.modules.values()].map((module) => [module.name, module.isStd]);
    expect(shipped).toEqual([
      ['main', false],
      ['prelude', true],
      ['time', true],
      ['json', true],
      ['testing', true],
      ['inbox', true],
    ]);
  });

  it('lists the given files it could not read, as given, and loads the rest', () => {
    const root = tempProject({ 'a.ista': '' });
    const { program, unreadable } = loadProject(root, ['a.ista', 'gone.ista', '.']);
    expect(unreadable).toEqual(['gone.ista', '.']);
    expect(program.roots.map((id) => program.modules.get(id)?.tree.source.path)).toEqual([
      'a.ista',
    ]);
  });
});

function textOf(program: Program, name: string): string | undefined {
  return [...program.modules.values()].find((module) => module.name === name)?.tree.source.text;
}

/** The project's sources as a walk of its tree afresh finds them. */
function walkedSources(root: string): readonly string[] {
  return globSync('**/*.ista', { cwd: root, exclude: ['**/node_modules', 'vendor'] })
    .map((path) => resolve(root, path))
    .sort();
}

/** Every directory under `root`, `root` included, its mtime set an hour back: long settled. */
function settle(root: string): void {
  const past = new Date(Date.now() - 3_600_000);
  for (const directory of [
    root,
    ...globSync('**/', { cwd: root }).map((path) => join(root, path)),
  ]) {
    utimesSync(directory, past, past);
  }
}

/** An edit of a project's tree, by path from its root, made long after or right after the last. */
interface TreeEdit {
  readonly kind: 'write' | 'remove';
  readonly path: string;
  readonly settledBefore: boolean;
}

const segment = fc.constantFrom('a', 'b', 'x.ista', 'node_modules', 'vendor', '.hidden');
const fileName = fc.constantFrom('m.ista', 'n.ista', 'note.txt', 'b');

const treeEdit: fc.Arbitrary<TreeEdit> = fc
  .record({
    kind: fc.constantFrom('write', 'write', 'remove'),
    path: fc
      .tuple(fc.array(segment, { maxLength: 3 }), fileName)
      .map(([directories, file]) => [...directories, file].join('/')),
    settledBefore: fc.boolean(),
  })
  .map((edit) => (edit.kind === 'remove' ? { ...edit, path: dirname(edit.path) } : edit));

function applyEdit(root: string, { kind, path }: TreeEdit): void {
  const target = join(root, path);
  if (kind === 'remove') {
    if (target !== root) {
      rmSync(target, { recursive: true, force: true });
    }
    return;
  }
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '');
  } catch {
    // A file stands where the edit needs a directory, or a directory where it writes a file.
  }
}

describe('findProjectSources', () => {
  it('finds what a walk afresh finds after every edit of the tree, settled or not', () => {
    fc.assert(
      fc.property(fc.array(treeEdit, { maxLength: 12 }), (edits) => {
        const root = tempProject({ 'main.ista': '' });
        for (const edit of edits) {
          if (edit.settledBefore) {
            settle(root);
          }
          expect(findProjectSources(root)).toEqual(walkedSources(root));
          applyEdit(root, edit);
          expect(findProjectSources(root)).toEqual(walkedSources(root));
        }
      }),
      { numRuns: 40 },
    );
  });

  it('sees a file added in the tick of a change made just before it found the sources', () => {
    const root = tempProject({ 'lib/main.ista': '' });
    const lib = join(root, 'lib');
    const tick = Date.now() / 1000;
    utimesSync(lib, tick, tick);
    expect(findProjectSources(root)).toEqual(walkedSources(root));
    writeFileSync(join(lib, 'added.ista'), '');
    utimesSync(lib, tick, tick);
    expect(findProjectSources(root)).toEqual(walkedSources(root));
  });
});
