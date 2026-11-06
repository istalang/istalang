/**
 * V8 CPU profiles captured through `node:inspector`, and their reading:
 * - A frame is keyed `file:function:line`, its file relative to `dist/` or `src/`, so profiles of
 *   built code read like the source tree.
 * - `samplesOf` gives each sample's stack, leaf first, without the profiler's own frames: the one
 *   reading every summary here and every report (analyze.ts) is built on.
 * - A summary counts a function's or a phase's inclusive time once per sample, however deep it
 *   recurses.
 */

import { writeFileSync } from 'node:fs';
import { type Profiler, type Runtime, Session } from 'node:inspector/promises';
import { resolve } from 'node:path';

interface TimedItem {
  readonly selfMs: number;
  readonly totalMs: number;
  readonly selfPct: number;
  readonly totalPct: number;
}

export interface ProfileSummary {
  readonly activeMs: number;
  readonly sampleCount: number;
  readonly phases: readonly ({ readonly phase: string } & TimedItem)[];
  readonly topSelfFns: readonly ({ readonly key: string } & TimedItem)[];
  readonly topTotalFns: readonly ({ readonly key: string } & TimedItem)[];
}

/** A function in a profile: where it is, and the toolchain phase its file belongs to. */
export interface Frame {
  readonly key: string;
  readonly file: string;
  readonly fn: string;
  readonly line: number;
  readonly phase: string;
}

/** One sample: its stack, leaf first, and the time it stands for. */
export interface Sample {
  readonly stack: readonly Frame[];
  readonly us: number;
}

interface FnStat extends Frame {
  selfUs: number;
  totalUs: number;
}

interface Stats {
  readonly fnStats: Map<string, FnStat>;
  readonly phaseStats: Map<string, { phase: string; selfUs: number; totalUs: number }>;
}

const samplingIntervalUs = 100;
const usPerMs = 1000;
const pctScale = 100;
const topLimit = 12;

const phasePrefixes: readonly (readonly [string, string])[] = [
  ['compiler/scanner/', 'scanner'],
  ['compiler/parser/', 'parser'],
  ['compiler/syntax/', 'syntax'],
  ['compiler/program/', 'program'],
  ['compiler/binder/', 'binder'],
  ['compiler/checker/', 'checker'],
  ['compiler/lowering/', 'lowering'],
  ['compiler/', 'compiler-coord'],
  ['definition/', 'definition'],
  ['runtime/', 'runtime'],
  ['stdlib/', 'stdlib'],
  ['formatter/', 'formatter'],
  ['language-service/', 'language-service'],
  ['structures/', 'structures'],
  ['text/', 'text'],
  ['language/', 'language'],
  ['node_modules/', 'node_modules'],
  ['node:', 'node-builtin'],
];

/** A script URL as a profile frame names its file: relative to `dist/` or `src/` where it has one. */
export function fileOfUrl(url: string): string {
  if (url === '') {
    return '(native/v8)';
  }
  for (const marker of ['/dist/', '/src/']) {
    const index = url.indexOf(marker);
    if (index !== -1) {
      return url.slice(index + marker.length);
    }
  }
  const nmIndex = url.indexOf('/node_modules/');
  return nmIndex === -1 ? url : `node_modules/${url.slice(nmIndex + '/node_modules/'.length)}`;
}

function phaseOfFile(file: string): string {
  return phasePrefixes.find(([prefix]) => file.startsWith(prefix))?.[1] ?? 'v8/native';
}

function isIgnoredFrame(meta: Frame | undefined): boolean {
  return (
    meta === undefined ||
    meta.fn === '(root)' ||
    meta.fn === '(program)' ||
    meta.fn === '(idle)' ||
    meta.file === 'node:inspector' ||
    meta.file.includes('/scripts/profile')
  );
}

export function round(value: number): number {
  return Math.round(value * pctScale) / pctScale;
}

function toTimed(selfUs: number, totalUs: number, denom: number): TimedItem {
  return {
    selfMs: round(selfUs / usPerMs),
    totalMs: round(totalUs / usPerMs),
    selfPct: round((selfUs * pctScale) / denom),
    totalPct: round((totalUs * pctScale) / denom),
  };
}

function addSelf(tree: Stats, leaf: Frame, dt: number): void {
  const fnEntry = tree.fnStats.get(leaf.key) ?? { ...leaf, selfUs: 0, totalUs: 0 };
  fnEntry.selfUs += dt;
  tree.fnStats.set(leaf.key, fnEntry);
  const phaseEntry = tree.phaseStats.get(leaf.phase) ?? {
    phase: leaf.phase,
    selfUs: 0,
    totalUs: 0,
  };
  phaseEntry.selfUs += dt;
  tree.phaseStats.set(leaf.phase, phaseEntry);
}

function addTotals(tree: Stats, stack: readonly Frame[], dt: number): void {
  const seenFn = new Set<string>();
  const seenPhase = new Set<string>();
  for (const meta of stack) {
    if (!seenFn.has(meta.key)) {
      seenFn.add(meta.key);
      const fnEntry = tree.fnStats.get(meta.key) ?? { ...meta, selfUs: 0, totalUs: 0 };
      fnEntry.totalUs += dt;
      tree.fnStats.set(meta.key, fnEntry);
    }
    if (!seenPhase.has(meta.phase)) {
      seenPhase.add(meta.phase);
      const phaseEntry = tree.phaseStats.get(meta.phase) ?? {
        phase: meta.phase,
        selfUs: 0,
        totalUs: 0,
      };
      phaseEntry.totalUs += dt;
      tree.phaseStats.set(meta.phase, phaseEntry);
    }
  }
}

/** The frame a V8 call frame (of a CPU or an allocation profile) stands for. */
export function frameOf(callFrame: Runtime.CallFrame): Frame {
  const file = fileOfUrl(callFrame.url);
  const fn = callFrame.functionName || '(anonymous)';
  const line = callFrame.lineNumber + 1;
  return { key: `${file}:${fn}:${line}`, file, fn, line, phase: phaseOfFile(file) };
}

/** Each sample of `profile` whose leaf isn't the profiler's own, with its stack, leaf first. */
export function* samplesOf(profile: Profiler.Profile): Generator<Sample> {
  const parentById = new Map<number, number>();
  const frames = new Map<number, Frame>();
  for (const node of profile.nodes) {
    frames.set(node.id, frameOf(node.callFrame));
    for (const childId of node.children ?? []) {
      parentById.set(childId, node.id);
    }
  }
  const stacks = new Map<number, readonly Frame[]>();
  const stackOf = (leafId: number): readonly Frame[] => {
    const known = stacks.get(leafId);
    if (known !== undefined) {
      return known;
    }
    const stack: Frame[] = [];
    for (let cur: number | undefined = leafId; cur !== undefined; cur = parentById.get(cur)) {
      const frame = frames.get(cur);
      if (frame !== undefined && !isIgnoredFrame(frame)) {
        stack.push(frame);
      }
    }
    stacks.set(leafId, stack);
    return stack;
  };
  const deltas = profile.timeDeltas ?? [];
  for (const [index, leafId] of (profile.samples ?? []).entries()) {
    if (!isIgnoredFrame(frames.get(leafId))) {
      yield { stack: stackOf(leafId), us: deltas[index] ?? samplingIntervalUs };
    }
  }
}

function analyzeProfile(profile: Profiler.Profile): ProfileSummary {
  const tree: Stats = { fnStats: new Map(), phaseStats: new Map() };
  let activeUs = 0;
  for (const { stack, us } of samplesOf(profile)) {
    const [leaf] = stack;
    if (leaf !== undefined) {
      activeUs += us;
      addSelf(tree, leaf, us);
      addTotals(tree, stack, us);
    }
  }

  const denom = activeUs || 1;
  return {
    activeMs: round(activeUs / usPerMs),
    sampleCount: profile.samples?.length ?? 0,
    phases: [...tree.phaseStats.values()]
      .sort((a, b) => b.selfUs - a.selfUs)
      .map((x) => ({ phase: x.phase, ...toTimed(x.selfUs, x.totalUs, denom) })),
    topSelfFns: [...tree.fnStats.values()]
      .sort((a, b) => b.selfUs - a.selfUs)
      .slice(0, topLimit)
      .map((x) => ({ key: x.key, ...toTimed(x.selfUs, x.totalUs, denom) })),
    topTotalFns: [...tree.fnStats.values()]
      .sort((a, b) => b.totalUs - a.totalUs)
      .slice(0, topLimit)
      .map((x) => ({ key: x.key, ...toTimed(x.selfUs, x.totalUs, denom) })),
  };
}

export async function withCpuProfile<T>(
  outDir: string | undefined,
  name: string,
  fn: () => T,
): Promise<{ readonly result: T; readonly wallMs: number; readonly summary: ProfileSummary }> {
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: samplingIntervalUs });
  await session.post('Profiler.start');
  const t0 = performance.now();
  const result = fn();
  const wallMs = performance.now() - t0;
  const { profile } = await session.post('Profiler.stop');
  session.disconnect();
  if (outDir !== undefined) {
    writeFileSync(resolve(outDir, `${name}.cpuprofile`), JSON.stringify(profile));
  }
  return { result, wallMs: round(wallMs), summary: analyzeProfile(profile) };
}
