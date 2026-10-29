/**
 * The loading core's own rules: which modules a program holds, that an import names exactly one
 * module, and what a rebuild reuses. Loaders are the host's: most cases use the in-memory loader,
 * whose paths are module keys verbatim, and loaders of other shapes are exercised on their own.
 * Graphs are generated where the rule is general, so the cases cover more than the shapes written.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Reported,
  reportedIn,
  reportedNothing,
  reportedOnce,
} from '../../diagnostics/diagnostic.test-kit.ts';
import { textOf } from '../../text/span.ts';
import { spanIn } from '../syntax/positions.ts';
import { programDiagnostics } from './diagnostics.ts';
import {
  type Files,
  idOf,
  loadedPaths,
  memoryLoader,
  moduleAt,
  programOf,
} from './program.test-kit.ts';
import {
  buildProgram,
  type LocatedModule,
  type ModuleId,
  type ModuleLoader,
  moduleIdOf,
  type Program,
} from './program.ts';

const { ambiguousImport, unresolvedImport } = programDiagnostics;

/** The label of the module each import of `key` resolved to, keyed by the import's path text. */
function resolvedImportsOf(program: Program, key: string): Record<string, string | undefined> {
  const { tree, imports } = moduleAt(program, key);
  return Object.fromEntries(
    [...imports].map(([item, target]) => [
      textOf(tree.source, spanIn(tree, item.path.span)),
      program.modules.get(target)?.tree.source.path,
    ]),
  );
}

describe('loading', () => {
  it('loads everything the roots import, transitively, each module once', () => {
    const program = programOf({
      main: "import a from 'a'\nimport b from 'b'",
      a: "import c from 'c'",
      b: "import c from 'c'",
      c: 'fn c(): 1',
      unused: 'fn u(): 1',
    });
    expect(loadedPaths(program)).toEqual(['main', 'a', 'b', 'c']);
  });

  it('follows import cycles without looping', () => {
    const program = programOf({
      a: "import b from 'b'",
      b: "import a from 'a'\nimport b from 'b'",
    });
    expect(loadedPaths(program)).toEqual(['a', 'b']);
    expect(resolvedImportsOf(program, 'b')).toEqual({ "'a'": 'a', "'b'": 'b' });
  });

  it('starts from every root, each once', () => {
    const program = programOf({ a: '', b: '' }, { roots: ['b', 'a', 'b'] });
    expect(loadedPaths(program)).toEqual(['b', 'a']);
    expect(program.roots).toEqual([idOf('b'), idOf('a')]);
  });

  it('leaves an import without a path to the parser, which already reported it', () => {
    const program = programOf({ main: 'import a from' });
    expect(moduleAt(program, 'main').diagnostics).toEqual([]);
    expect(moduleAt(program, 'main').tree.diagnostics).not.toEqual([]);
  });
});

describe('a path names exactly one module', () => {
  const main = moduleIdOf(new URL('db:modules/main'));
  const library = moduleIdOf(new URL('db:modules/library'));
  const other = moduleIdOf(new URL('db:other/library'));

  function moduleOf(id: ModuleId, text = ''): LocatedModule {
    return { id, name: id, label: `<${id}>`, read: () => text };
  }

  function load(text: string, ...loaders: ModuleLoader[]): Program {
    return buildProgram({ roots: [moduleOf(main, text)], loaders });
  }

  function reportedFor(program: Program): Reported | undefined {
    const module = program.modules.get(main);
    return module && reportedIn(module.tree.source, module.diagnostics);
  }

  it('reports a path that no loader answers, and leaves the import unresolved', () => {
    const program = load("import a from 'nowhere'", () => undefined);
    expect(reportedFor(program)).toEqual(reportedOnce(unresolvedImport.code, "'nowhere'"));
    expect(program.modules.get(main)?.imports.size).toBe(0);
  });

  it('accepts paths in whatever syntax a loader understands, under its own scheme', () => {
    const program = load("import lib from 'pkg:library@2'", (path) =>
      path === 'pkg:library@2' ? moduleOf(library) : undefined,
    );
    expect(program.modules.get(main)?.imports.size).toBe(1);
    expect(program.modules.has(library)).toBe(true);
  });

  it('reports a path two loaders answer with different modules, naming both', () => {
    const program = load(
      "import lib from 'library'",
      () => moduleOf(library),
      () => moduleOf(other),
    );
    const [diagnostic] = program.modules.get(main)?.diagnostics ?? [];
    expect(reportedFor(program)).toEqual(reportedOnce(ambiguousImport.code, "'library'"));
    expect(diagnostic?.message).toContain(`<${library}>`);
    expect(diagnostic?.message).toContain(`<${other}>`);
  });

  it("takes two loaders answering with the same module as one answer, the first one's", () => {
    const program = load(
      "import lib from 'library'",
      () => moduleOf(library, 'fn open(): 1'),
      () => moduleOf(library, 'fn saved(): 1'),
    );
    expect(reportedFor(program)).toEqual(reportedNothing);
    expect(program.modules.get(library)?.tree.source.text).toBe('fn open(): 1');
  });
});

describe('reading', () => {
  it('reads each module once per build, however many imports name it', () => {
    const files = {
      main: "import a from 'a'\nimport b from 'b'",
      a: "import b from 'b'\nimport main from 'main'",
      b: "import a from 'a'",
    };
    const reads = new Map<string, number>();
    const counting: ModuleLoader = (path) =>
      path in files
        ? {
            id: idOf(path),
            name: path,
            label: path,
            read: () => {
              reads.set(path, (reads.get(path) ?? 0) + 1);
              return files[path as keyof typeof files];
            },
          }
        : undefined;
    const roots = [counting('main', idOf(''))].filter((root) => root !== undefined);
    buildProgram({ roots, loaders: [counting] });
    expect(Object.fromEntries(reads)).toEqual({ main: 1, a: 1, b: 1 });
  });

  it('never reads a module whose import is ambiguous', () => {
    let read = false;
    const located = (id: ModuleId): LocatedModule => ({
      id,
      name: id,
      label: id,
      read: () => {
        read = true;
        return '';
      },
    });
    const main = { id: idOf('main'), name: 'main', label: 'main', read: () => "import x from 'x'" };
    buildProgram({
      roots: [main],
      loaders: [() => located(idOf('one')), () => located(idOf('two'))],
    });
    expect(read).toBe(false);
  });
});

describe('a random module graph', () => {
  /** Modules 0..count-1; module i imports the indexes in imports[i], some of which don't exist. */
  const graph = fc.integer({ min: 1, max: 6 }).chain((count) =>
    fc.tuple(
      fc.constant(count),
      fc.array(fc.array(fc.nat({ max: count + 1 }), { maxLength: 3 }), {
        minLength: count,
        maxLength: count,
      }),
    ),
  );

  function filesOf(imports: readonly (readonly number[])[]): Files {
    return Object.fromEntries(
      imports.map((targets, index) => [
        `m${index}`,
        targets.map((target) => `import x from 'm${target}'`).join('\n'),
      ]),
    );
  }

  function reachableFrom0(count: number, imports: readonly (readonly number[])[]): Set<number> {
    const seen = new Set([0]);
    for (const index of seen) {
      for (const target of imports[index] ?? []) {
        if (target < count) {
          seen.add(target);
        }
      }
    }
    return seen;
  }

  it('loads exactly the modules reachable from the root, and reports every missing target', () => {
    fc.assert(
      fc.property(graph, ([count, imports]) => {
        const program = programOf(filesOf(imports), { roots: ['m0'] });
        const reachable = reachableFrom0(count, imports);
        expect(new Set(program.modules.keys())).toEqual(
          new Set([...reachable].map((index) => idOf(`m${index}`))),
        );
        for (const index of reachable) {
          const targets = imports[index] ?? [];
          const { diagnostics } = moduleAt(program, `m${index}`);
          expect(diagnostics.length).toBe(targets.filter((target) => target >= count).length);
        }
      }),
    );
  });

  it('never throws, whatever a second loader answers', () => {
    const answer = fc.option(fc.constantFrom('m0', 'm1', 'elsewhere'), { nil: undefined });
    fc.assert(
      fc.property(graph, answer, ([, imports], key) => {
        const files = filesOf(imports);
        const extra: ModuleLoader = () =>
          key === undefined
            ? undefined
            : { id: idOf(key), name: key, label: key, read: () => files[key] ?? '' };
        const load = memoryLoader(files);
        const roots = [load('m0', idOf(''))].filter((root) => root !== undefined);
        const program = buildProgram({ roots, loaders: [load, extra] });
        expect(program.modules.has(idOf('m0'))).toBe(true);
      }),
    );
  });
});

describe('rebuilding from a previous snapshot', () => {
  const files = { main: "import a from 'a'\nimport b from 'b'", a: 'fn a(): 1', b: 'fn b(): 2' };

  it('reuses every unchanged tree and re-parses the edited one', () => {
    const before = programOf(files);
    const after = programOf({ ...files, a: 'fn a(): 3' }, { previous: before });
    expect(moduleAt(after, 'main').tree).toBe(moduleAt(before, 'main').tree);
    expect(moduleAt(after, 'b').tree).toBe(moduleAt(before, 'b').tree);
    expect(moduleAt(after, 'a').tree).not.toBe(moduleAt(before, 'a').tree);
  });

  it('reuses a tree when a loader hands back equal text in a new SourceText', () => {
    const before = programOf(files);
    const after = programOf({ ...files }, { previous: before });
    expect(moduleAt(after, 'a').tree).toBe(moduleAt(before, 'a').tree);
  });

  it('drops a module nothing imports any more', () => {
    const before = programOf(files);
    const after = programOf({ ...files, main: "import a from 'a'" }, { previous: before });
    expect(loadedPaths(after)).toEqual(['main', 'a']);
  });
});
