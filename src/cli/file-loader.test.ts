/**
 * The CLI's file loader on real files: where each form of path points, that two paths to one file
 * name one module, and that anything outside the path syntax, or a file that isn't there, names
 * nothing.
 */

import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type ModuleId, moduleIdOf } from '../compiler/program/program.ts';
import { tempProject } from './cli.test-kit.ts';
import { fileLoader, locateFile } from './file-loader.ts';

const files = {
  'a.ista': 'fn a(): 1',
  'a.test.ista': 'fn t(): 1',
  'deep/x.ista': 'fn x(): 2',
  'deep/inner/m.ista': '',
  'deep/inner/sib.ista': '',
};

const permissionDenied = /EACCES/u;

function idOfFile(root: string, path: string): ModuleId {
  return moduleIdOf(pathToFileURL(join(root, path)));
}

describe('fileLoader', () => {
  it('takes a relative path from the importing file and a bare one from the project root', () => {
    const root = tempProject(files);
    const load = fileLoader({ projectRoot: root, cwd: root });
    const importer = idOfFile(root, 'deep/inner/m.ista');
    expect(load('../../a', importer)?.id).toBe(idOfFile(root, 'a.ista'));
    expect(load('./sib', importer)?.id).toBe(idOfFile(root, 'deep/inner/sib.ista'));
    expect(load('deep/x', importer)?.id).toBe(idOfFile(root, 'deep/x.ista'));
  });

  it("returns the file's text, labelled by its path from the working directory", () => {
    const root = tempProject(files);
    const load = fileLoader({ projectRoot: root, cwd: join(root, 'deep') });
    const loaded = load('a', idOfFile(root, 'deep/x.ista'));
    expect(loaded?.read()).toBe('fn a(): 1');
    expect(loaded?.label).toBe(join('..', 'a.ista'));
    expect(loaded?.isTest).toBe(false);
    expect(load('a.test', idOfFile(root, 'deep/x.ista'))?.isTest).toBe(true);
  });

  it('names a module by its path from the project root, wherever the toolchain runs', () => {
    const root = tempProject(files);
    const importer = idOfFile(root, 'deep/x.ista');
    const names = [root, join(root, 'deep'), join(root, 'deep', 'inner')].map(
      (cwd) => fileLoader({ projectRoot: root, cwd })('./inner/m', importer)?.name,
    );
    expect(names).toEqual(['deep/inner/m', 'deep/inner/m', 'deep/inner/m']);
  });

  it('names one module by every path that reaches its file', () => {
    const root = tempProject(files);
    const load = fileLoader({ projectRoot: root, cwd: root });
    const fromX = load('../a', idOfFile(root, 'deep/x.ista'));
    const fromRoot = load('a', idOfFile(root, 'deep/x.ista'));
    expect(fromX?.id).toBe(fromRoot?.id);
  });

  it.each([
    [''],
    ['/abs'],
    ['a/'],
    ['a//b'],
    ['a/./b'],
    ['deep/../a'],
    ['.'],
    ['..'],
    ['./'],
    ['a.ista'],
    ['https://example.com/a'],
    ['a\\..\\..\\x'],
    ['C:/x'],
  ])('names nothing with %j', (path) => {
    const root = tempProject(files);
    expect(
      fileLoader({ projectRoot: root, cwd: root })(path, idOfFile(root, 'deep/x.ista')),
    ).toBeUndefined();
  });

  it('locates a file without reading it, leaving the read to the loading core', ({ skip }) => {
    skip(process.getuid?.() === 0, 'root reads files regardless of their permissions');
    const root = tempProject(files);
    chmodSync(join(root, 'a.ista'), 0o000);
    const located = locateFile(join(root, 'a.ista'), { projectRoot: root, cwd: root });
    expect(located?.id).toBe(idOfFile(root, 'a.ista'));
    expect(() => located?.read()).toThrow(permissionDenied);
  });

  it('names nothing relative to a module that is not a file', () => {
    const root = tempProject(files);
    expect(
      fileLoader({ projectRoot: root, cwd: root })('./a', moduleIdOf(new URL('std:time'))),
    ).toBeUndefined();
  });

  it('names nothing where the file is missing or is a directory', () => {
    const root = tempProject(files);
    mkdirSync(join(root, 'folder.ista'));
    const load = fileLoader({ projectRoot: root, cwd: root });
    expect(load('missing', idOfFile(root, 'a.ista'))).toBeUndefined();
    expect(load('folder', idOfFile(root, 'a.ista'))).toBeUndefined();
    expect(locateFile(join(root, 'deep'), { projectRoot: root, cwd: root })).toBeUndefined();
  });
});
