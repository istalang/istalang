/**
 * Profiles whole checks (load, bind, every module's diagnostics; no lowering) over inputs.ts's
 * programs, each workload repeated so its profile holds enough samples, in one of three modes:
 * - `cpu`: a V8 CPU profile per workload (`<name>.cpuprofile`), which analyze.ts reads.
 * - `count`: every function's exact call count (`<name>.counts.json`), from V8's precise coverage
 *   rather than sampling, so "called N times" is a fact; analyze.ts joins it to its report.
 * - `alloc`: allocation sampling, objects the collector already took included
 *   (`<name>.heapprofile`), which allocations.ts reads: what the GC's share is spent on.
 * `fb-cold` runs first in the process, so it is the one cold, unjitted check; the rest are warm.
 * Counting slows code down, so compare times only between runs of the same mode.
 *
 * Usage: npm run profile:check -- <out-dir> <cpu|count|alloc> [workload ...]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { type HeapProfiler, Session } from 'node:inspector/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { checkProgram } from '../../src/compiler/checker/check.ts';
import { diagnose } from '../../src/compiler/compile.ts';
import { fileOfUrl, round, withCpuProfile } from './cpu-profile.ts';
import {
  corpusPaths,
  corpusProgram,
  decimalTests,
  everyStdProgram,
  formBuilderProgram,
  programOf,
  repeated,
  stdTestsProgram,
} from './inputs.ts';

interface Workload {
  readonly repeat: number;
  readonly run: () => void;
}

const decimalScale = 16;
const allocationSamplingBytes = 4096;
const jsonIndent = 2;

const workloads = {
  'fb-cold': { repeat: 1, run: () => diagnose(formBuilderProgram().program) },
  'fb-warm': { repeat: 10, run: () => diagnose(formBuilderProgram().program) },
  'std-tests': { repeat: 5, run: () => diagnose(stdTestsProgram()) },
  'every-std': {
    repeat: 5,
    run: () => {
      const program = everyStdProgram();
      const checker = checkProgram(program);
      for (const [id, module] of program.modules) {
        if (module.isStd) {
          checker.diagnosticsOf(id);
        }
      }
    },
  },
  decimal16: {
    repeat: 3,
    run: () => diagnose(programOf('scaled.test', repeated(decimalTests(), decimalScale), true)),
  },
  corpus: {
    repeat: 1,
    run: () => {
      for (const path of corpusPaths()) {
        diagnose(corpusProgram(path));
      }
    },
  },
} satisfies Record<string, Workload>;

type Mode = 'cpu' | 'count' | 'alloc';

/** Runs `workload`, timing each repeat in milliseconds. */
function timed(workload: Workload): readonly number[] {
  return Array.from({ length: workload.repeat }, () => {
    const start = performance.now();
    workload.run();
    return round(performance.now() - start);
  });
}

/** Each function's call count over `workload`, keyed `file:function` as profile frames are. */
async function callCounts(session: Session, workload: Workload): Promise<Record<string, number>> {
  await session.post('Profiler.takePreciseCoverage');
  timed(workload);
  const { result } = await session.post('Profiler.takePreciseCoverage');
  const counts: Record<string, number> = {};
  for (const script of result) {
    for (const fn of script.functions) {
      const count = fn.ranges[0]?.count ?? 0;
      if (count > 0) {
        const key = `${fileOfUrl(script.url)}:${fn.functionName || '(anonymous)'}`;
        counts[key] = (counts[key] ?? 0) + count;
      }
    }
  }
  return counts;
}

/** `workload`'s allocations, sampled with the objects already collected kept in. */
async function allocations(
  session: Session,
  workload: Workload,
): Promise<HeapProfiler.SamplingHeapProfile> {
  await session.post('HeapProfiler.enable');
  await session.post('HeapProfiler.startSampling', {
    samplingInterval: allocationSamplingBytes,
    // biome-ignore lint/style/useNamingConvention: V8's option name (HeapProfiler.startSampling).
    includeObjectsCollectedByMajorGC: true,
    // biome-ignore lint/style/useNamingConvention: V8's option name (HeapProfiler.startSampling).
    includeObjectsCollectedByMinorGC: true,
  });
  timed(workload);
  const { profile } = await session.post('HeapProfiler.stopSampling');
  return profile;
}

async function profileWorkload(
  session: Session,
  { mode, outDir, name }: { readonly mode: Mode; readonly outDir: string; readonly name: string },
  workload: Workload,
): Promise<readonly number[]> {
  const output = (suffix: string, value: unknown) =>
    writeFileSync(resolve(outDir, `${name}.${suffix}`), JSON.stringify(value));
  switch (mode) {
    case 'cpu':
      return (await withCpuProfile(outDir, name, () => timed(workload))).result;
    case 'count':
      output('counts.json', await callCounts(session, workload));
      return [];
    case 'alloc':
      output('heapprofile', await allocations(session, workload));
      return [];
    default: {
      const unhandled: never = mode;
      return unhandled;
    }
  }
}

async function main(): Promise<void> {
  const [, , outDir, mode = 'cpu', ...only] = process.argv;
  if (outDir === undefined || !['cpu', 'count', 'alloc'].includes(mode)) {
    throw new Error('Usage: check-workloads.ts <out-dir> <cpu|count|alloc> [workload ...]');
  }
  mkdirSync(outDir, { recursive: true });
  const session = new Session();
  session.connect();
  if (mode === 'count') {
    // Counting from the start, so functions compiled before a workload are counted too; it slows
    // every call, so only this mode does it.
    await session.post('Profiler.enable');
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
  }
  const times: Record<string, readonly number[]> = {};
  for (const [name, workload] of Object.entries(workloads)) {
    if (only.length === 0 || only.includes(name)) {
      // biome-ignore lint/performance/noAwaitInLoops: workloads run one at a time, each profiled alone.
      times[name] = await profileWorkload(session, { mode: mode as Mode, outDir, name }, workload);
    }
  }
  session.disconnect();
  process.stdout.write(`${JSON.stringify({ mode, times }, null, jsonIndent)}\n`);
}

await main();
