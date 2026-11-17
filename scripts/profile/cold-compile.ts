/**
 * The toolchain end to end and cold: load (scan, parse), bind, check every module, lower, encode
 * the Definition, then what a host does with it: deploy (emit, store) and start, or run the tests. Each run is in its own process, so no run is warmed by another and nothing is cached. A
 * run imports the modules first and starts the profiler after, so a profile holds the toolchain's
 * work only, not loading it.
 * - `minimal`: one module whose `main` opens a runtime and returns, compiled, deployed and run.
 * - `fb`: the form builder, compiled from its synthetic entry (`compileProgram`) and deployed; its
 *   start needs a host's externs, so it isn't started.
 * - `std-tests`: every std test module, compiled for running (`compileTests`) and run.
 * Each run writes `cold-<workload>-<run>.cpuprofile`, which analyze.ts merges with a glob
 * (`cold-fb-*`); the parent prints each phase's mean over the runs.
 *
 * Usage: npm run profile:cold -- <out-dir> [runs] [workload ...]
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
import { bindProgram } from '../../src/compiler/binder/bind.ts';
import { compileProgram, compileTests, diagnose } from '../../src/compiler/compile.ts';
import type { Program } from '../../src/compiler/program/program.ts';
import { type EncodedDefinition, encodeDefinition } from '../../src/definition/definition.ts';
import type { Definition } from '../../src/definition/tables/index.ts';
import { realTime } from '../../src/runtime/clock.ts';
import { createRuntime } from '../../src/runtime/host/index.ts';
import { memoryStore } from '../../src/runtime/store.ts';
import { runTests } from '../../src/runtime/testing/run-tests.ts';
import { stdNatives } from '../../src/stdlib/natives.ts';
import { round, withCpuProfile } from './cpu-profile.ts';
import { formBuilderProgram, programOf, stdTestsProgram } from './inputs.ts';

/** Ends the phase running since the last lap, naming it. */
type Lap = (phase: string) => void;

/** A program loaded (its modules scanned and parsed), how to lower it, and what a host does next. */
interface Loaded {
  readonly program: Program;
  /** Lowers the program once it is checked: the compilation's outcome. */
  readonly lower: () => { readonly kind: string; readonly definition?: Definition };
  /** What a host does with the encoded Definition, lapping each phase. */
  readonly host: (encoded: EncodedDefinition, lap: Lap) => Promise<void>;
}

const minimalMain = [
  "import * as runtime from 'runtime'",
  'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
  'ista async fn _main() -> Int: 0',
].join('\n');

const testTimeoutMs = 5000n;

/** An instance seed's length, random-draws.ts `seedBytes`, which the build doesn't export. */
const seedLength = 32;

const runtimeOf = () =>
  createRuntime({
    natives: stdNatives,
    store: memoryStore(),
    clock: realTime,
    seed: () => randomBytes(seedLength),
  });

const workloads = {
  minimal: () => {
    const program = programOf('main', minimalMain, false);
    const [mainId] = program.roots;
    if (mainId === undefined) {
      throw new Error('The minimal program has no root.');
    }
    return {
      program,
      lower: () => compileProgram(program, mainId),
      host: async (encoded, lap) => {
        const deployed = runtimeOf().deploy(encoded);
        lap('deploy');
        await deployed.start('main');
        lap('start');
      },
    };
  },
  fb: () => {
    const { program, mainId } = formBuilderProgram();
    return {
      program,
      lower: () => compileProgram(program, mainId),
      host: (encoded, lap) => {
        runtimeOf().deploy(encoded);
        lap('deploy');
        return Promise.resolve();
      },
    };
  },
  'std-tests': () => {
    const program = stdTestsProgram();
    return {
      program,
      lower: () => compileTests(program),
      host: async (encoded, lap) => {
        const options = { natives: stdNatives, clock: realTime, timeout: testTimeoutMs };
        for await (const _ of runTests(encoded, options)) {
          // Only the run's time is measured, not its reports.
        }
        lap('run');
      },
    };
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
  const profiled = await withCpuProfile(outDir, `cold-${name}-${run}`, async () => {
    let start = performance.now();
    const lap = (phase: string) => {
      const now = performance.now();
      phases[phase] = round(now - start);
      start = now;
    };
    const { program, lower, host }: Loaded = workloads[name]();
    lap('load');
    bindProgram(program);
    lap('bind');
    diagnose(program);
    lap('check');
    const { kind, definition } = lower();
    lap('lower');
    if (definition !== undefined) {
      const encoded = encodeDefinition(definition);
      lap('write');
      await host(encoded, lap);
    }
    return kind;
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
        const args = [
          ...process.execArgv,
          import.meta.filename,
          childFlag,
          first,
          name,
          String(run + 1),
        ];
        return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' })) as RunResult;
      });
      return [name, { outcomes: [...new Set(results.map((r) => r.outcome))], ms: means(results) }];
    }),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
