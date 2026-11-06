/**
 * The compiler end to end and cold: load (scan, parse), bind, check every module, lower; each run in
 * its own process, so no run is warmed by another and nothing is cached. A run imports the modules
 * first and starts the profiler after, so a profile holds the compiler's work only, not loading it.
 * - `fb`: the form builder, compiled from its synthetic entry (`compileProgram`).
 * - `std-tests`: every std test module, compiled for running (`compileTests`).
 * Each run writes `cold-<workload>-<run>.cpuprofile`, which analyze.ts merges with a glob
 * (`cold-fb-*`); the parent prints each phase's mean over the runs.
 *
 * Usage: node scripts/profile/cold-compile.ts <out-dir> [runs] [workload ...]
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
import type { Program } from '../../src/compiler/program/program.ts';
import { round, withCpuProfile } from './cpu-profile.ts';
import { built, formBuilderProgram, stdTestsProgram } from './inputs.ts';

const { compileProgram, compileTests, diagnose } =
  await built<typeof import('../../src/compiler/compile.ts')>('compiler/compile.js');
const { bindProgram } =
  await built<typeof import('../../src/compiler/binder/bind.ts')>('compiler/binder/bind.js');

/** A program loaded (its modules scanned and parsed), and how to lower what it runs. */
interface Loaded {
  readonly program: Program;
  /** Lowers the program once it is checked; the kind of the compilation's outcome. */
  readonly lower: () => string;
}

const workloads = {
  fb: () => {
    const { program, mainId } = formBuilderProgram();
    return { program, lower: () => compileProgram(program, mainId).kind };
  },
  'std-tests': () => {
    const program = stdTestsProgram();
    return { program, lower: () => compileTests(program).kind };
  },
} satisfies Record<string, () => Loaded>;

type WorkloadName = keyof typeof workloads;

const defaultRuns = 5;
const childFlag = '--child';

interface RunResult {
  readonly outcome: string;
  readonly phases: Readonly<Record<string, number>>;
}

/** One cold compile of `name` in this process, its phases timed, profiled into `outDir`. */
async function runChild(outDir: string, name: WorkloadName, run: string): Promise<RunResult> {
  const phases: Record<string, number> = {};
  const profiled = await withCpuProfile(outDir, `cold-${name}-${run}`, () => {
    let start = performance.now();
    const lap = (phase: string) => {
      const now = performance.now();
      phases[phase] = round(now - start);
      start = now;
    };
    const { program, lower } = workloads[name]();
    lap('load');
    bindProgram(program);
    lap('bind');
    diagnose(program);
    lap('check');
    const outcome = lower();
    lap('lower');
    return outcome;
  });
  return { outcome: profiled.result, phases };
}

/** Each phase's mean over `results`, with the total. */
function means(results: readonly RunResult[]): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const { phases } of results) {
    for (const [phase, ms] of Object.entries(phases)) {
      sums[phase] = (sums[phase] ?? 0) + ms;
    }
  }
  const mean = Object.fromEntries(
    Object.entries(sums).map(([phase, sum]) => [phase, round(sum / results.length)]),
  );
  return { ...mean, total: round(Object.values(mean).reduce((all, ms) => all + ms, 0)) };
}

function isWorkload(name: string): name is WorkloadName {
  return Object.hasOwn(workloads, name);
}

async function main(): Promise<void> {
  const [, , first, ...rest] = process.argv;
  if (first === childFlag) {
    const [outDir = '.', name = '', run = '0'] = rest;
    if (!isWorkload(name)) {
      throw new Error(`Unknown workload ${name}`);
    }
    process.stdout.write(JSON.stringify(await runChild(outDir, name, run)));
    return;
  }
  if (first === undefined) {
    throw new Error('Usage: cold-compile.ts <out-dir> [runs] [workload ...]');
  }
  mkdirSync(first, { recursive: true });
  const [runsText, ...only] = rest;
  const runs = runsText === undefined ? defaultRuns : Number(runsText);
  const names = Object.keys(workloads).filter((name) => only.length === 0 || only.includes(name));
  const report = Object.fromEntries(
    names.map((name) => {
      const results = Array.from({ length: runs }, (_, run): RunResult => {
        const args = [import.meta.filename, childFlag, first, name, String(run + 1)];
        return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' })) as RunResult;
      });
      return [name, { outcomes: [...new Set(results.map((r) => r.outcome))], ms: means(results) }];
    }),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
