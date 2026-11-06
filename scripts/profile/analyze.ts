/**
 * Reports on CPU profiles (`.cpuprofile`, from check-workloads.ts, cold-compile.ts or the toolchain
 * profile): where time goes, and who spends it.
 * - A name with `*` merges every matching profile's samples, so several cold runs read as one.
 * - Self time is the leaf's; inclusive time counts a function once per sample, however deep it
 *   recurses. Inclusive shares overlap, so they never sum to 100%.
 * - Where `<name>.counts.json` sits beside the profile (check-workloads.ts `count`), each function
 *   shows its exact call count over the same workload.
 * - `--subsystem name=a,b` groups the frames whose key holds `a` or `b`: its inclusive and self
 *   shares, and where it is entered from (its outermost frame's caller, memo and entry-table
 *   plumbing skipped), which is how a cost is traced to the decision that pays it.
 * - `--within s` keeps only samples with a frame matching `s`, e.g. one phase's work.
 * - `--callers f` attributes `f`'s self time to its callers; `--children f` splits `f`'s inclusive
 *   time over what it calls; `--stacks f` lists the commonest stacks into `f`.
 *
 * Usage: node scripts/profile/analyze.ts <dir> <name|glob> [--top N] [--within s]
 *          [--subsystem name=a,b]... [--callers f]... [--children f]... [--stacks f]...
 */

import { globSync, readFileSync } from 'node:fs';
import type { Profiler } from 'node:inspector/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { type Frame, type Sample, samplesOf } from './cpu-profile.ts';
import { isToolchainPhase, printList, Tally } from './report.ts';

interface Subsystem {
  readonly name: string;
  readonly matches: readonly string[];
  inclusiveUs: number;
  selfUs: number;
  readonly entries: Tally;
}

interface Options {
  readonly top: number;
  readonly within: string | undefined;
  readonly callers: readonly string[];
  readonly children: readonly string[];
  readonly stacks: readonly string[];
}

interface Report {
  totalUs: number;
  sampleCount: number;
  readonly frames: Map<string, Frame>;
  readonly self: Tally;
  readonly inclusive: Tally;
  readonly byFile: Tally;
  readonly byFolder: Tally;
  readonly callers: Map<string, Tally>;
  readonly children: Map<string, Tally>;
  readonly stacks: Map<string, Tally>;
  readonly subsystems: readonly Subsystem[];
}

const defaultTop = 30;
const usPerMs = 1000;
const percent = 100;
const stackDepth = 5;
/** Column widths: a time, a call count. */
const timeWidth = 10;
const countWidth = 12;
/** Frames that only route a call (memoizing, entry tables): skipped when naming who entered. */
const plumbing = ['structures/memo', 'structures/entries'];

function tallies(names: readonly string[]): Map<string, Tally> {
  return new Map(names.map((name) => [name, new Tally()]));
}

function emptyReport(options: Options, subsystems: readonly string[]): Report {
  return {
    totalUs: 0,
    sampleCount: 0,
    frames: new Map(),
    self: new Tally(),
    inclusive: new Tally(),
    byFile: new Tally(),
    byFolder: new Tally(),
    callers: tallies(options.callers),
    children: tallies(options.children),
    stacks: tallies(options.stacks),
    subsystems: subsystems.map((spec) => {
      const [name = spec, matches = ''] = spec.split('=');
      return { name, matches: matches.split(','), inclusiveUs: 0, selfUs: 0, entries: new Tally() };
    }),
  };
}

/** A frame's key without its line, as callers and entries name it. */
function placeOf(frame: Frame): string {
  return `${frame.file}:${frame.fn}`;
}

function recordTotals(report: Report, { stack, us }: Sample, leaf: Frame): void {
  report.totalUs += us;
  report.self.add(leaf.key, us);
  report.byFile.add(leaf.file, us);
  report.byFolder.add(isToolchainPhase(leaf.phase) ? dirname(leaf.file) : leaf.phase, us);
  for (const frame of new Map(stack.map((each) => [each.key, each])).values()) {
    report.frames.set(frame.key, frame);
    report.inclusive.add(frame.key, us);
  }
}

function recordCallers(report: Report, { stack, us }: Sample, leaf: Frame): void {
  for (const [target, tally] of report.callers) {
    if (leaf.key.includes(target)) {
      const caller = stack
        .slice(1)
        .find(
          (frame) =>
            !(frame.key.includes(target) || plumbing.some((skip) => frame.file.startsWith(skip))),
        );
      tally.add(caller?.key ?? '(root)', us);
    }
  }
}

function recordChildren(report: Report, { stack, us }: Sample): void {
  for (const [target, tally] of report.children) {
    const outermost = stack.findLastIndex((frame) => frame.key.includes(target));
    if (outermost !== -1) {
      tally.add(outermost === 0 ? '(self)' : (stack[outermost - 1]?.key ?? '(self)'), us);
    }
  }
}

function recordStacks(report: Report, { stack, us }: Sample, leaf: Frame): void {
  for (const [target, tally] of report.stacks) {
    if (leaf.key.includes(target)) {
      tally.add(
        stack
          .slice(1, stackDepth + 1)
          .map((frame) => frame.fn)
          .join(' < '),
        us,
      );
    }
  }
}

function recordSubsystems(report: Report, { stack, us }: Sample, leaf: Frame): void {
  for (const subsystem of report.subsystems) {
    const inside = (frame: Frame) => subsystem.matches.some((match) => frame.key.includes(match));
    const outermost = stack.findLastIndex(inside);
    if (outermost !== -1) {
      subsystem.inclusiveUs += us;
      subsystem.selfUs += inside(leaf) ? us : 0;
      const entered = stack[outermost];
      const caller = stack
        .slice(outermost + 1)
        .find((frame) => !plumbing.some((skip) => frame.file.startsWith(skip)));
      const from = caller === undefined ? '(root)' : placeOf(caller);
      subsystem.entries.add(`${from}  ->  ${entered === undefined ? '?' : placeOf(entered)}`, us);
    }
  }
}

function record(report: Report, sample: Sample, within: string | undefined): void {
  const [leaf] = sample.stack;
  if (
    leaf === undefined ||
    (within !== undefined && !sample.stack.some((frame) => frame.key.includes(within)))
  ) {
    return;
  }
  recordTotals(report, sample, leaf);
  recordCallers(report, sample, leaf);
  recordChildren(report, sample);
  recordStacks(report, sample, leaf);
  recordSubsystems(report, sample, leaf);
}

/** Exact call counts by `file:function`, where a counts file sits beside the profile. */
function callCountsOf(dir: string, name: string): ReadonlyMap<string, number> {
  if (name.includes('*')) {
    return new Map();
  }
  try {
    const counts = JSON.parse(readFileSync(resolve(dir, `${name}.counts.json`), 'utf8'));
    return new Map(Object.entries(counts as Record<string, number>));
  } catch {
    return new Map();
  }
}

function print(report: Report, options: Options, counts: ReadonlyMap<string, number>): void {
  const ms = (us: number) => `${(us / usPerMs).toFixed(1)}ms`.padStart(timeWidth);
  const calls = (key: string) => {
    const frame = report.frames.get(key);
    const count = frame === undefined ? undefined : counts.get(placeOf(frame));
    return (count === undefined ? '' : count.toLocaleString('en')).padStart(countWidth);
  };
  const timed = { whole: report.totalUs, amount: ms };
  const counted = { ...timed, detail: calls };
  const percentOf = (us: number) => `${((us * percent) / (report.totalUs || 1)).toFixed(1)}%`;
  process.stdout.write(
    `== active ${ms(report.totalUs).trim()} over ${report.sampleCount} samples\n`,
  );
  printList('top self', report.self.top(options.top), counted);
  const own = report.inclusive
    .top(Number.POSITIVE_INFINITY)
    .filter(([key]) => isToolchainPhase(report.frames.get(key)?.phase ?? ''));
  printList('top inclusive (toolchain code)', own.slice(0, options.top), counted);
  printList('self by folder', report.byFolder.top(options.top), timed);
  printList('self by file', report.byFile.top(options.top), timed);
  for (const [target, tally] of report.callers) {
    printList(`callers of ${target} (its self time)`, tally.top(options.top), timed);
  }
  for (const [target, tally] of report.children) {
    printList(`inside ${target} (its inclusive time)`, tally.top(options.top), counted);
  }
  for (const [target, tally] of report.stacks) {
    printList(`stacks into ${target}`, tally.top(options.top), timed);
  }
  for (const { name, inclusiveUs, selfUs, entries } of report.subsystems) {
    const shares = `inclusive ${percentOf(inclusiveUs)}, self ${percentOf(selfUs)}`;
    printList(`subsystem ${name}: ${shares}; entered from`, entries.top(options.top), timed);
  }
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      top: { type: 'string' },
      within: { type: 'string' },
      subsystem: { type: 'string', multiple: true },
      callers: { type: 'string', multiple: true },
      children: { type: 'string', multiple: true },
      stacks: { type: 'string', multiple: true },
    },
  });
  const [dir, name] = positionals;
  if (dir === undefined || name === undefined) {
    throw new Error('Usage: analyze.ts <dir> <name|glob> [options] (see the banner)');
  }
  const options: Options = {
    top: values.top === undefined ? defaultTop : Number(values.top),
    within: values.within,
    callers: values.callers ?? [],
    children: values.children ?? [],
    stacks: values.stacks ?? [],
  };
  const paths = globSync(`${name}.cpuprofile`, { cwd: dir }).sort();
  if (paths.length === 0) {
    throw new Error(`No profile matches ${name}.cpuprofile in ${dir}`);
  }
  const report = emptyReport(options, values.subsystem ?? []);
  for (const path of paths) {
    const profile = JSON.parse(readFileSync(resolve(dir, path), 'utf8')) as Profiler.Profile;
    report.sampleCount += profile.samples?.length ?? 0;
    for (const sample of samplesOf(profile)) {
      record(report, sample, options.within);
    }
  }
  process.stdout.write(`${paths.length} profile(s): ${paths.join(', ')}\n`);
  print(report, options, callCountsOf(dir, name));
}

main();
