/**
 * The module paths completion offers in an import's path, in a project the file loader reads: by
 * one name from the importer's folder or the project root, the std modules where a path starts,
 * and, over any text written so far, hostile included, exactly the modules that load by the path
 * they complete, the importer aside, and the folders that go on with more.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildProgram,
  type LocatedModule,
  type ModuleId,
  type Program,
} from '../../../compiler/program/program.ts';
import { fileLoader, locateFile, moduleIdOfFile } from '../../../project/file-loader.ts';
import type { ProjectFiles } from '../../../project/project-files.ts';
import { importableStdModules, stdlibLoader, stdRoles } from '../../../stdlib/stdlib-loader.ts';
import { completionsAt } from '../index.ts';

const places = { projectRoot: '/p', cwd: '/p' };
const project = [
  'purchase/approve',
  'purchase/reject',
  'purchase/rules/limits',
  'tools',
  'tools.test',
  'a b',
];
const fileOf = (name: string) => `/p/${name}.ista`;

const loaders = [stdlibLoader(), fileLoader(places, filesWith('tools', ''))];

/** The project's files, `importer`'s holding `importerText`. */
function filesWith(importer: string, importerText: string): ProjectFiles {
  const texts = new Map(
    project.map((name) => [fileOf(name), name === importer ? importerText : '']),
  );
  return {
    isFile: (path) => texts.has(path),
    read: (path) => texts.get(path) ?? '',
  };
}

let previous: Program | undefined;

/** The paths offered at the end of `written`, the path's text in an import of `importer`. */
function offeredAt(
  written: string,
  importer = 'purchase/approve',
): readonly { readonly name: string; readonly kind: string }[] {
  const text = `import a from '${written}'\n`;
  const files = filesWith(importer, text);
  previous = buildProgram(
    {
      roots: project.flatMap((name) => locateFile(fileOf(name), places, files) ?? []),
      loaders: [stdlibLoader(), fileLoader(places, files)],
      roles: stdRoles(),
    },
    previous,
  );
  const module: ModuleId = moduleIdOfFile(fileOf(importer));
  const offset = text.indexOf("'") + 1 + written.length;
  return completionsAt(previous, module, offset, { stdModules: importableStdModules });
}

const importerId = moduleIdOfFile(fileOf('purchase/approve'));

/** The module `path`, written in the module `purchase/approve`, names, as a loader finds it. */
function loaded(path: string): LocatedModule | undefined {
  return loaders.map((load) => load(path, importerId)).find((module) => module !== undefined);
}

/** Whether `path`, written in the module `purchase/approve`, names a module a loader finds. */
function loads(path: string): boolean {
  return loaded(path) !== undefined;
}

/** Every name a path may go on with here: the project's folders and modules, and the std's. */
const nextNames = [
  ...new Set([...project.flatMap((name) => name.split('/')), ...importableStdModules, 'prelude']),
];

/** Whether `path` names a module an import of `purchase/approve` may name: not itself, nor the prelude. */
function namesImportable(path: string): boolean {
  const module = loaded(path);
  return (
    module !== undefined &&
    module.id !== importerId &&
    (module.isStd !== true || importableStdModules.includes(module.name))
  );
}

/** Whether `path` is a folder holding a project module, at any depth: the module loads through it. */
function holdsModule(path: string): boolean {
  return project.some((name) => {
    const parts = name.split('/');
    const id = moduleIdOfFile(fileOf(name));
    return parts.some(
      (_part, start) => start > 0 && loaded(`${path}/${parts.slice(start).join('/')}`)?.id === id,
    );
  });
}

const names = (written: string, importer?: string) =>
  offeredAt(written, importer).map(({ name }) => name);

const piece = fc.constantFrom(
  '.',
  '..',
  '',
  'purchase',
  'rules',
  'tools',
  'a:b',
  'x\\y',
  '#?',
  '/',
);
/** What would end the path's string, or escape in it. */
const endsString = /['\n\r\\]/u;

/** Texts written in a path so far: pieces of paths, hostile ones included, or any text. */
const writtenTexts = fc.oneof(
  fc.array(piece, { maxLength: 5 }).map((pieces) => pieces.join('/')),
  fc.string({ maxLength: 10 }).filter((text) => !endsString.test(text)),
);

describe('module paths in an import', () => {
  it("go on from the importer's folder by one name, never above the root", () => {
    expect(names('./')).toEqual(['reject', 'rules/']);
    expect(names('./rules/')).toEqual(['limits']);
    expect(names('../')).toEqual(['purchase/', 'tools', 'tools.test', 'a b']);
    expect(names('../../')).toEqual([]);
    expect(names('./nowhere/')).toEqual([]);
  });

  it('go on from the project root without `./`, past no `.` or `..` there', () => {
    expect(names('purchase/', 'tools')).toEqual(['approve', 'reject', 'rules/']);
    expect(names('purchase/rules/')).toEqual(['limits']);
    expect(names('purchase/../')).toEqual([]);
  });

  it("start with the std modules, `testing` in a test module's alone", () => {
    const offered = names('', 'tools');
    expect(offered).toEqual(expect.arrayContaining(['time', 'json', 'inbox', 'purchase/']));
    expect(offered).not.toContain('testing');
    expect(offered).not.toContain('prelude');
    expect(names('', 'tools.test')).toContain('testing');
    expect(names('purchase/', 'tools')).not.toContain('time');
  });

  it('offer, over any text written, modules that load and folders that go on', () => {
    fc.assert(
      fc.property(writtenTexts, (text) => {
        const folder = text.slice(0, text.lastIndexOf('/') + 1);
        const goesNowhere = ({ name, kind }: { readonly name: string; readonly kind: string }) =>
          kind === 'folder'
            ? offeredAt(`${folder}${name}`).length === 0
            : kind !== 'module' || !loads(`${folder}${name}`);
        expect(offeredAt(text).filter(goesNowhere)).toEqual([]);
      }),
      {
        numRuns: 60,
        examples: [['./'], ['../'], [''], ['//'], ['http://[/'], ['/'], ['purchase/../'], ['a:b/']],
      },
    );
  });

  it('offer, over any text written, every module that loads by one name more, and its folders', () => {
    fc.assert(
      fc.property(writtenTexts, (text) => {
        const folder = text.slice(0, text.lastIndexOf('/') + 1);
        const offered = names(text);
        const expected = nextNames.flatMap((name) => [
          ...(namesImportable(`${folder}${name}`) && name !== 'testing' ? [name] : []),
          ...(holdsModule(`${folder}${name}`) ? [`${name}/`] : []),
        ]);
        expect(expected.filter((name) => !offered.includes(name))).toEqual([]);
      }),
      { numRuns: 60, examples: [['./'], ['../'], [''], ['purchase/'], ['./rules/']] },
    );
  });
});
