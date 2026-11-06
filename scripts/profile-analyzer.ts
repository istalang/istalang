/**
 * Analyzes V8 `.cpuprofile` call trees captured via `node:inspector`, computing per-function
 * and per-phase self time and inclusive (total) time with recursion deduplicated per sample.
 */

import { writeFileSync } from 'node:fs';
import { type Profiler, Session } from 'node:inspector/promises';
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

interface FnStat {
  readonly key: string;
  readonly file: string;
  readonly fn: string;
  readonly line: number;
  readonly phase: string;
  selfUs: number;
  totalUs: number;
}

interface FrameTree {
  readonly parentById: ReadonlyMap<number, number>;
  readonly nodeMeta: ReadonlyMap<number, Omit<FnStat, 'selfUs' | 'totalUs'>>;
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

function cleanUrl(url: string): string {
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

function isIgnoredFrame(meta: Omit<FnStat, 'selfUs' | 'totalUs'> | undefined): boolean {
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

function addSelf(tree: FrameTree, leaf: Omit<FnStat, 'selfUs' | 'totalUs'>, dt: number): void {
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

function walkAncestors(tree: FrameTree, leafId: number, dt: number): void {
  const seenFn = new Set<string>();
  const seenPhase = new Set<string>();
  for (let cur: number | undefined = leafId; cur !== undefined; cur = tree.parentById.get(cur)) {
    const meta = tree.nodeMeta.get(cur);
    if (meta !== undefined && !isIgnoredFrame(meta)) {
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
}

function buildFrameTree(profile: Profiler.Profile): FrameTree {
  const parentById = new Map<number, number>();
  const nodeMeta = new Map<number, Omit<FnStat, 'selfUs' | 'totalUs'>>();
  for (const node of profile.nodes) {
    const file = cleanUrl(node.callFrame.url);
    const fn = node.callFrame.functionName || '(anonymous)';
    const line = node.callFrame.lineNumber + 1;
    nodeMeta.set(node.id, {
      key: `${file}:${fn}:${line}`,
      file,
      fn,
      line,
      phase: phaseOfFile(file),
    });
    for (const childId of node.children ?? []) {
      parentById.set(childId, node.id);
    }
  }
  return { parentById, nodeMeta, fnStats: new Map(), phaseStats: new Map() };
}

function analyzeProfile(profile: Profiler.Profile): ProfileSummary {
  const tree = buildFrameTree(profile);
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let activeUs = 0;

  for (const [index, leafId] of samples.entries()) {
    const dt = deltas[index] ?? samplingIntervalUs;
    const leaf = tree.nodeMeta.get(leafId);
    if (leaf !== undefined && !isIgnoredFrame(leaf)) {
      activeUs += dt;
      addSelf(tree, leaf, dt);
      walkAncestors(tree, leafId, dt);
    }
  }

  const denom = activeUs || 1;
  return {
    activeMs: round(activeUs / usPerMs),
    sampleCount: samples.length,
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
