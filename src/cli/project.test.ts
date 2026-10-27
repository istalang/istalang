/**
 * The CLI's composition of loaders on a real project: what a command's roots and imports load
 * from, and the one rule that spans loaders, that a path naming both a std module and a project
 * file is ambiguous.
 */

import { describe, expect, it } from 'vitest';
import { programDiagnostics } from '../compiler/program/diagnostics.ts';
import { stdlibLoader } from '../stdlib/stdlib-loader.ts';
import { tempProject } from './cli.test-kit.ts';
import { loadProject } from './project.ts';

describe('loadProject', () => {
  it('reports a bare path that names both a std module and a project file, naming both', () => {
    const root = tempProject({ 'main.ista': "import * as time from 'time'\n", 'time.ista': '' });
    const { program } = loadProject(root, ['main.ista'], stdlibLoader({ time: '' }));
    const [main] = program.modules.values();
    expect(main?.diagnostics.map(({ code }) => code)).toEqual([
      programDiagnostics.ambiguousImport.code,
    ]);
    expect(main?.diagnostics[0]?.message).toContain('std:time');
    expect(main?.diagnostics[0]?.message).toContain('time.ista');
  });

  it('loads a std module when no project file claims its name', () => {
    const root = tempProject({ 'main.ista': "import * as time from 'time'\n" });
    const { program } = loadProject(root, ['main.ista'], stdlibLoader({ time: 'fn now(): 1' }));
    expect([...program.modules.values()].map(({ tree }) => tree.source.path)).toEqual([
      'main.ista',
      'std:prelude',
      'std:time',
      'std:json',
      'std:testing',
    ]);
  });

  it('loads the prelude, time, json and testing with every program, by their roles', () => {
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
