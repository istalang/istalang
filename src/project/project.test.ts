/**
 * The apps' composition of loaders on a real project: what an app's roots and imports load from,
 * open documents laid over the disk, and the one rule that spans loaders, that a path naming both
 * a std module and a project file is ambiguous.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { programDiagnostics } from '../compiler/program/diagnostics.ts';
import { moduleIdOf, type Program } from '../compiler/program/program.ts';
import { tempProject } from './project.test-kit.ts';
import { loadProject } from './project.ts';
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
