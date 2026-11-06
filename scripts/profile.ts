/**
 * Profiles the Istalang toolchain across compilation phases, incremental checking, language
 * service queries, formatting, and the standard library test suite using Node's V8 CPU profiler
 * (`node:inspector`), reporting per-phase and per-function self/total time, type-allocation
 * counts, incremental recomputation counts, and 1x/4x/16x scaling timings.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import type { LocatedModule, Program } from '../src/compiler/program/program.ts';
import type { FunctionDeclaration } from '../src/compiler/syntax/declarations.ts';
import { round, withCpuProfile } from './profile-analyzer.ts';

/** Loads the built module at `path` under `dist/`, typed as its `src/` module. */
async function built<Module>(path: string): Promise<Module> {
  return (await import(new URL(`../dist/${path}`, import.meta.url).href)) as Module;
}

const { checkProgram } = await built<typeof import('../src/compiler/checker/check.ts')>(
  'compiler/checker/check.js',
);
const { ProgramChecker } = await built<typeof import('../src/compiler/checker/program-checker.ts')>(
  'compiler/checker/program-checker.js',
);
const { typeKeys } = await built<typeof import('../src/compiler/checker/types/type-keys.ts')>(
  'compiler/checker/types/type-keys.js',
);
const { compileTests, diagnose } =
  await built<typeof import('../src/compiler/compile.ts')>('compiler/compile.js');
const { lower } = await built<typeof import('../src/compiler/lowering/lower.ts')>(
  'compiler/lowering/lower.js',
);
const { parse } = await built<typeof import('../src/compiler/parser/parse.ts')>(
  'compiler/parser/parse.js',
);
const { buildProgram, moduleIdOf } = await built<
  typeof import('../src/compiler/program/program.ts')
>('compiler/program/program.js');
const { scan } = await built<typeof import('../src/compiler/scanner/scan.ts')>(
  'compiler/scanner/scan.js',
);
const { definitionFormat } = await built<typeof import('../src/definition/definition.ts')>(
  'definition/definition.js',
);
const { formatSource } =
  await built<typeof import('../src/formatter/format.ts')>('formatter/format.js');
const { checkedModule } = await built<typeof import('../src/language-service/checked-module.ts')>(
  'language-service/checked-module.js',
);
const { completionsAt } = await built<typeof import('../src/language-service/completion/index.ts')>(
  'language-service/completion/index.js',
);
const { inlayHintsIn } = await built<typeof import('../src/language-service/inlay-hints.ts')>(
  'language-service/inlay-hints.js',
);
const { referencesAt } = await built<
  typeof import('../src/language-service/navigation/references.ts')
>('language-service/navigation/references.js');
const { builtKeyTypesOf } = await built<
  typeof import('../src/language-service/semantic-tokens/built-keys.ts')
>('language-service/semantic-tokens/built-keys.js');
const { semanticTokensOf } = await built<
  typeof import('../src/language-service/semantic-tokens/semantic-tokens.ts')
>('language-service/semantic-tokens/semantic-tokens.js');
const { Workspace } = await built<typeof import('../src/language-service/workspace.ts')>(
  'language-service/workspace.js',
);
const { findProjectSources, findSources, loadProject } =
  await built<typeof import('../src/project/project.ts')>('project/project.js');
const { diskFiles } = await built<typeof import('../src/project/project-files.ts')>(
  'project/project-files.js',
);
const { runTests } = await built<typeof import('../src/runtime/testing/run-tests.ts')>(
  'runtime/testing/run-tests.js',
);
const { stdNatives } = await built<typeof import('../src/stdlib/natives.ts')>('stdlib/natives.js');
const { stdlibLoader, stdRoles } =
  await built<typeof import('../src/stdlib/stdlib-loader.ts')>('stdlib/stdlib-loader.js');
const { createSourceText } =
  await built<typeof import('../src/text/source-text.ts')>('text/source-text.js');

const editRuns = 5;
const defaultTimeoutMs = 5000n;
const initialClockMs = 1_000_000n;
const scaleSmall = 1;
const scaleMedium = 4;
const scaleLarge = 16;
const scales = [scaleSmall, scaleMedium, scaleLarge] as const;
const midpointDivisor = 2;
const jsonIndent = 2;
const refNameOffset = 2;

const declaredName = /^(?:fn|struct|enum|type|const|trait) (?<name>[A-Za-z_]\w*)\b(?!\.)/gmu;
const lastDigit = /\d(?=\D*$)/u;

function repeated(text: string, times: number): string {
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.floor(sorted.length / midpointDivisor)] ?? 0);
}

function measureOneScale(decimalTests: string, scale: number): Record<string, number> {
  const scaledMod = moduleIdOf(new URL('file:///project/scaled.test.ista'));
  const makeScaled = (text: string, previous?: Program) =>
    buildProgram(
      {
        roots: [
          {
            id: scaledMod,
            name: 'scaled.test',
            label: 'scaled.test.ista',
            isTest: true,
            read: () => text,
          },
        ],
        loaders: [stdlibLoader()],
        roles: stdRoles(),
      },
      previous,
    );
  const baseText = repeated(decimalTests, scale);
  const target = 'String(d0(x).round(2, mode))';
  const edited = baseText.replace(target, target.replace(lastDigit, '7'));
  const source = createSourceText('scaled.test.ista', baseText);
  const ws = new Workspace((open, prev) => makeScaled(open.get(scaledMod) ?? '', prev));
  ws.write(scaledMod, baseText);
  ws.diagnosticsOf(scaledMod);
  let next = edited;
  const editTimes: number[] = [];
  for (let i = 0; i < editRuns; i += 1) {
    const t0 = performance.now();
    ws.write(scaledMod, next);
    ws.diagnosticsOf(scaledMod);
    editTimes.push(performance.now() - t0);
    next = next === edited ? baseText : edited;
  }
  const t0Parse = performance.now();
  parse(source, scan(source));
  const parseMs = round(performance.now() - t0Parse);
  const cm = checkedModule(ws.program, scaledMod);
  const t0Sem = performance.now();
  if (cm !== undefined) {
    semanticTokensOf(cm.tree, builtKeyTypesOf(cm));
  }
  const semTokMs = round(performance.now() - t0Sem);
  const t0Inlay = performance.now();
  inlayHintsIn(ws.program, scaledMod, { start: 0, end: baseText.length });
  const inlayMs = round(performance.now() - t0Inlay);
  const t0Comp = performance.now();
  completionsAt(ws.program, scaledMod, baseText.indexOf(target) + 'String('.length);
  const compMs = round(performance.now() - t0Comp);
  return {
    lines: baseText.split('\n').length,
    parseMs,
    incEditMedianMs: median(editTimes),
    compMs,
    semTokMs,
    inlayMs,
  };
}

function measureScaling(decimalTests: string): Record<number, Record<string, number>> {
  return Object.fromEntries(scales.map((scale) => [scale, measureOneScale(decimalTests, scale)]));
}

function createEntryBuffer(fbDir: string): {
  readonly mainId: ReturnType<typeof moduleIdOf>;
  readonly mainBuffer: LocatedModule;
} {
  const mainId = moduleIdOf(new URL(`file://${fbDir}/main-entry.ista`));
  const mainLines = [
    "import * as sup from './supplier.gen'",
    "import * as ord from './order.gen'",
    'async fn main() -> Future<Int>:',
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

async function profileFormBuilder(outDir: string | undefined, fbDir: string) {
  const fbSources = findProjectSources(fbDir);
  const { mainId, mainBuffer } = createEntryBuffer(fbDir);

  let typeKeyCalls = 0;
  const uniqueTypeObjects = new Set<object>();
  const uniqueTypeKeys = new Set<string>();
  const origTypeKey = typeKeys.typeKey;
  (typeKeys as { typeKey: typeof origTypeKey }).typeKey = (type, positions) => {
    typeKeyCalls += 1;
    uniqueTypeObjects.add(type);
    const key = origTypeKey(type, positions);
    uniqueTypeKeys.add(key);
    return key;
  };

  const fbCheckProf = await withCpuProfile(outDir, 'formbuilder-check', () => {
    const { program } = loadProject(fbDir, fbSources, { buffers: [mainBuffer] });
    diagnose(program);
    return program;
  });
  const checkTypeStats = {
    typeKeyCalls,
    uniqueTypeObjects: uniqueTypeObjects.size,
    uniqueTypeKeys: uniqueTypeKeys.size,
  };
  const fbChecker = checkProgram(fbCheckProf.result);
  const fbMain = fbCheckProf.result.modules
    .get(mainId)
    ?.tree.root.items.find(
      (item): item is FunctionDeclaration => item.kind === 'FunctionDeclaration',
    );
  if (fbMain === undefined) {
    throw new Error('Missing synthetic main');
  }
  lower(fbChecker, fbMain);
  typeKeyCalls = 0;
  uniqueTypeObjects.clear();
  const fbLowerProf = await withCpuProfile(outDir, 'formbuilder-lower', () =>
    lower(fbChecker, fbMain),
  );
  const lowerTypeStats = {
    typeKeyCalls,
    uniqueTypeObjects: uniqueTypeObjects.size,
    uniqueTypeKeys: uniqueTypeKeys.size,
  };
  (typeKeys as { typeKey: typeof origTypeKey }).typeKey = origTypeKey;
  return { fbCheckProf, checkTypeStats, fbLowerProf, lowerTypeStats };
}

async function profileFormBuilderTools(outDir: string | undefined, fbDir: string) {
  const fbSources = findProjectSources(fbDir);
  const supId = moduleIdOf(new URL(`file://${fbDir}/supplier.gen.ista`));
  const supOrig = readFileSync(resolve(fbDir, 'supplier.gen.ista'), 'utf8');
  const supEdited = supOrig.replace('120', '121');
  const prog1 = loadProject(fbDir, fbSources).program;
  const checker1 = new ProgramChecker(prog1);
  checker1.diagnosticsOf(supId);
  const prog2 = loadProject(fbDir, fbSources, {
    files: {
      ...diskFiles,
      read: (p) => (p.endsWith('supplier.gen.ista') ? supEdited : diskFiles.read(p)),
    },
    previous: prog1,
  }).program;
  const recomputedTables: Record<string, number> = {};
  const fbIncProf = await withCpuProfile(outDir, 'formbuilder-inc-edit', () => {
    const checker2 = new ProgramChecker(prog2, {
      previous: checker1,
      observe: (table) => {
        recomputedTables[table] = (recomputedTables[table] ?? 0) + 1;
      },
    });
    checker2.diagnosticsOf(supId);
  });
  const refOffset = supOrig.indexOf('addressModel') + refNameOffset;
  const fbRefsProf = await withCpuProfile(outDir, 'formbuilder-refs', () => {
    const { program } = loadProject(fbDir, fbSources);
    referencesAt(program, supId, refOffset);
  });
  return { fbIncProf, recomputedTables, fbRefsProf };
}

function profileStdTests(outDir: string | undefined, root: string) {
  const stdTestFiles = findSources(resolve(root, 'src/stdlib'), '.test.ista');
  return withCpuProfile(outDir, 'std-tests', () => {
    const { program } = loadProject(root, stdTestFiles);
    const compiled = compileTests(program);
    if (compiled.kind === 'compiled') {
      const { text } = definitionFormat.write(compiled.definition);
      let now = initialClockMs;
      const run = runTests(text, {
        natives: stdNatives,
        now: () => now,
        timeout: defaultTimeoutMs,
      });
      for (let step = run.next(); step.done !== true; step = run.next()) {
        if (typeof step.value === 'bigint') {
          now = step.value;
        }
      }
    }
  });
}

async function main(): Promise<void> {
  const [, , outDir] = process.argv;
  if (outDir !== undefined) {
    mkdirSync(outDir, { recursive: true });
  }
  const root = process.cwd();
  const fbDir = resolve(root, 'examples/FormBuilder');
  const fbSources = findProjectSources(fbDir);
  const fb = await profileFormBuilder(outDir, fbDir);
  const fbTools = await profileFormBuilderTools(outDir, fbDir);
  const fmtSources = [...fbSources, ...findSources(resolve(root, 'src/stdlib'), '.ista')].map((p) =>
    createSourceText(p, readFileSync(p, 'utf8')),
  );
  const fmtProf = await withCpuProfile(outDir, 'formatter', () => {
    for (const source of fmtSources) {
      formatSource(source);
    }
  });
  const stdProf = await profileStdTests(outDir, root);

  const decimalTests = readFileSync(resolve(root, 'src/stdlib/decimal/decimal.test.ista'), 'utf8');
  const scaling = measureScaling(decimalTests);

  process.stdout.write(
    `${JSON.stringify(
      {
        formBuilderCheck: {
          wallMs: fb.fbCheckProf.wallMs,
          typeStats: fb.checkTypeStats,
          profile: fb.fbCheckProf.summary,
        },
        formBuilderLower: {
          wallMs: fb.fbLowerProf.wallMs,
          typeStats: fb.lowerTypeStats,
          profile: fb.fbLowerProf.summary,
        },
        formBuilderIncEdit: {
          wallMs: fbTools.fbIncProf.wallMs,
          recomputedTables: fbTools.recomputedTables,
          profile: fbTools.fbIncProf.summary,
        },
        formBuilderRefs: {
          wallMs: fbTools.fbRefsProf.wallMs,
          profile: fbTools.fbRefsProf.summary,
        },
        formatter: { wallMs: fmtProf.wallMs, profile: fmtProf.summary },
        stdTests: { wallMs: stdProf.wallMs, profile: stdProf.summary },
        scaling,
      },
      null,
      jsonIndent,
    )}\n`,
  );
}

await main();
