/**
 * What every profiling script measures, in one place:
 * - The built modules: imported as their `src/` paths, loaded from `dist/` (from-dist.ts).
 * - The form builder with a synthetic `main` entry, since the prototype declares none.
 * - A test module repeated to scale, each copy's declarations renamed so the copies don't clash.
 * - The programs a whole check or compile is measured on: the form builder, the std test modules,
 *   every std module, a scaled test module, and each corpus program.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LocatedModule, ModuleId, Program } from '../../src/compiler/program/program.ts';
import { buildProgram, moduleIdOf } from '../../src/compiler/program/program.ts';
import { languageModules } from '../../src/foundation/language/well-known/index.ts';
import { findProjectSources, findSources, loadProject } from '../../src/project/project.ts';
import { stdModuleSources } from '../../src/stdlib/std-sources.ts';
import { stdlibLoader, stdRoles } from '../../src/stdlib/stdlib-loader.ts';

export const repoRoot = resolve(import.meta.dirname, '../..');
export const formBuilderDir = resolve(repoRoot, 'examples/FormBuilder');
const stdDir = resolve(repoRoot, 'src/stdlib');
const decimalTestsPath = resolve(stdDir, 'decimal/decimal.test.ista');

const declaredName =
  /^(?:(?:extern|shared|sendable|live|ista|async) )*(?:fn|struct|enum|type|const|trait) (?<name>[A-Za-z_]\w*)\b(?!\.)/gmu;

/** `text`'s imports once, then its other lines `times` over, each copy's declarations suffixed. */
export function repeated(text: string, times: number): string {
  const lines = text.split('\n');
  const imports = lines.filter((line) => line.startsWith('import '));
  const rest = lines.filter((line) => !line.startsWith('import ')).join('\n');
  const declared = [...rest.matchAll(declaredName)]
    .map((match) => match.groups?.name ?? '')
    .filter((name, index, all) => all.indexOf(name) === index);
  const copies = Array.from({ length: times }, (_, copy) =>
    declared.reduce(
      (renamed, name) => renamed.replaceAll(new RegExp(`\\b${name}\\b`, 'gu'), `${name}${copy}`),
      rest,
    ),
  );
  return [...imports, ...copies].join('\n');
}

/** The std decimal tests, whose overloaded arithmetic makes a call-heavy module to scale. */
export function decimalTests(): string {
  return readFileSync(decimalTestsPath, 'utf8');
}

/** The form builder's synthetic entry: a `main` reaching both generated forms. */
export function formBuilderEntry(): {
  readonly mainId: ModuleId;
  readonly mainBuffer: LocatedModule;
} {
  const mainId = moduleIdOf(new URL(`file://${formBuilderDir}/main-entry.ista`));
  const mainLines = [
    "import * as sup from './supplier.gen'",
    "import * as ord from './order.gen'",
    'async fn main() -> Int:',
    '  const _f1 = sup.supplierForm',
    '  const _f2 = ord.orderForm',
    '  0',
    '',
  ];
  return {
    mainId,
    mainBuffer: {
      id: mainId,
      name: 'main-entry',
      label: 'main-entry.ista',
      read: () => mainLines.join('\n'),
    },
  };
}

/** The form builder's program with its synthetic entry, and that entry's id. */
export function formBuilderProgram(): { readonly program: Program; readonly mainId: ModuleId } {
  const { mainId, mainBuffer } = formBuilderEntry();
  const { program } = loadProject(formBuilderDir, findProjectSources(formBuilderDir), {
    buffers: [mainBuffer],
  });
  return { program, mainId };
}

/** Every std test module, as `ista test` loads them. */
export function stdTestsProgram(): Program {
  return loadProject(repoRoot, findSources(stdDir, '.test.ista')).program;
}

/** One module of `text` named `name`, over the std library; a test module when `isTest`. */
export function programOf(
  name: string,
  text: string,
  isTest: boolean,
  previous?: Program,
): Program {
  const id = moduleIdOf(new URL(`file:///project/${name}.ista`));
  return buildProgram(
    {
      roots: [{ id, name, label: `${name}.ista`, isTest, read: () => text }],
      loaders: [stdlibLoader()],
      roles: stdRoles(),
    },
    previous,
  );
}

/** A program importing every std module, so each one is loaded and can be checked whole. */
export function everyStdProgram(): Program {
  const imports = Object.keys(stdModuleSources)
    .filter((name) => name !== languageModules.prelude)
    .map((name) => `import * as ${name} from '${name}'`);
  return programOf('main', imports.join('\n'), false);
}

/** Every corpus program's path, one program per file. */
export function corpusPaths(): readonly string[] {
  return findSources(resolve(repoRoot, 'test/corpus'), '.ista');
}

/** The program of the corpus file at `path`, loaded as `ista check` would. */
export function corpusProgram(path: string): Program {
  return loadProject(resolve(path, '..'), [path]).program;
}
