/**
 * Profiles the Istalang toolchain across compilation phases, incremental checking, language
 * service queries, formatting, and the standard library test suite using Node's V8 CPU profiler
 * (`node:inspector`), reporting per-phase and per-function self/total time, type-allocation
 * counts, incremental recomputation counts, and 1x/4x/16x scaling timings.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { checkProgram } from '../../src/compiler/checker/check.ts';
import { typeKeys } from '../../src/compiler/checker/types/identity/type-keys.ts';
import { ProgramChecker } from '../../src/compiler/checker/wiring/program/program-checker.ts';
import { compileTests, diagnose } from '../../src/compiler/compile.ts';
import { lower } from '../../src/compiler/lowering/lower.ts';
import { parse } from '../../src/compiler/parser/parse.ts';
import { moduleIdOf } from '../../src/compiler/program/program.ts';
import { scan } from '../../src/compiler/scanner/scan.ts';
import type { FunctionDeclaration } from '../../src/compiler/syntax/declarations/index.ts';
import { encodeDefinition } from '../../src/definition/definition.ts';
import { completionsAt } from '../../src/editor/language-service/completion/index.ts';
import { inlayHintsIn } from '../../src/editor/language-service/inlay-hints.ts';
import { referencesAt } from '../../src/editor/language-service/navigation/references.ts';
import { checkedModule } from '../../src/editor/language-service/reading/checked-module.ts';
import { semanticTokensOf } from '../../src/editor/language-service/semantic-tokens/semantic-tokens.ts';
import { Workspace } from '../../src/editor/language-service/workspace.ts';
import { formatSource } from '../../src/formatter/format.ts';
import { createSourceText } from '../../src/foundation/text/source-text.ts';
import { findProjectSources, findSources, loadProject } from '../../src/project/project.ts';
import { diskFiles } from '../../src/project/project-files.ts';
import { ManualClock } from '../../src/runtime/clock.ts';
import { runTests } from '../../src/runtime/testing/run-tests.ts';
import { stdNatives } from '../../src/stdlib/natives.ts';
import { round, withCpuProfile } from './cpu-profile.ts';
import {
  decimalTests,
  formBuilderDir,
  formBuilderEntry,
  programOf,
  repeated,
  repoRoot,
} from './inputs.ts';

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

const lastDigit = /\d(?=\D*$)/u;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.floor(sorted.length / midpointDivisor)] ?? 0);
}

function measureOneScale(tests: string, scale: number): Record<string, number> {
  const scaledMod = moduleIdOf(new URL('file:///project/scaled.test.ista'));
  const baseText = repeated(tests, scale);
  const target = 'String(d0(x).round(2, mode))';
  const edited = baseText.replace(target, target.replace(lastDigit, '7'));
  const source = createSourceText('scaled.test.ista', baseText);
  const ws = new Workspace((open, prev) =>
    programOf('scaled.test', open.get(scaledMod) ?? '', true, prev),
  );
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
    semanticTokensOf(cm.tree);
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

function measureScaling(tests: string): Record<number, Record<string, number>> {
  return Object.fromEntries(scales.map((scale) => [scale, measureOneScale(tests, scale)]));
}

async function profileFormBuilder(outDir: string | undefined, fbDir: string) {
  const fbSources = findProjectSources(fbDir);
  const { mainId, mainBuffer } = formBuilderEntry();

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
  const refOffset = supOrig.indexOf('addressView') + refNameOffset;
  const fbRefsProf = await withCpuProfile(outDir, 'formbuilder-refs', () => {
    const { program } = loadProject(fbDir, fbSources);
    referencesAt(program, supId, refOffset);
  });
  return { fbIncProf, recomputedTables, fbRefsProf };
}

function profileStdTests(outDir: string | undefined, root: string) {
  const stdTestFiles = findSources(resolve(root, 'src/stdlib'), '.test.ista');
  return withCpuProfile(outDir, 'std-tests', async () => {
    const { program } = loadProject(root, stdTestFiles);
    const compiled = compileTests(program);
    if (compiled.kind === 'compiled') {
      const encoded = encodeDefinition(compiled.definition);
      const clock = new ManualClock(initialClockMs);
      for await (const _ of runTests(encoded, {
        natives: stdNatives,
        clock,
        timeout: defaultTimeoutMs,
      })) {
        // Only the run's time is measured, not its reports.
      }
    }
  });
}

async function main(): Promise<void> {
  const [, , outDir] = process.argv;
  if (outDir !== undefined) {
    mkdirSync(outDir, { recursive: true });
  }
  const root = repoRoot;
  const fbDir = formBuilderDir;
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

  const scaling = measureScaling(decimalTests());

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
