/**
 * Reports on an allocation profile (`.heapprofile`, check-workloads.ts `alloc`): which functions
 * allocate, which callers make them, and which call chains, so the garbage collector's share of a
 * profile can be traced to the code that feeds it. The profile keeps objects already collected, so
 * bytes are everything allocated, not what survived; sampled, so sizes are estimates.
 *
 * Usage: node scripts/profile/allocations.ts <dir> <name> [--top N]
 */

import { readFileSync } from 'node:fs';
import type { HeapProfiler } from 'node:inspector/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { type Frame, frameOf } from './cpu-profile.ts';
import { isToolchainPhase, printList, Tally } from './report.ts';

const defaultTop = 30;
const bytesPerMb = 1e6;
const chainDepth = 4;
const sizeWidth = 10;

interface Allocations {
  totalBytes: number;
  readonly phases: Map<string, string>;
  readonly self: Tally;
  readonly inclusive: Tally;
  readonly chains: Tally;
}

/** Walks the allocation tree, each node with its stack root first, without recursing. */
function tally(head: HeapProfiler.SamplingHeapProfileNode): Allocations {
  const allocations: Allocations = {
    totalBytes: 0,
    phases: new Map(),
    self: new Tally(),
    inclusive: new Tally(),
    chains: new Tally(),
  };
  const pending: { node: HeapProfiler.SamplingHeapProfileNode; stack: readonly Frame[] }[] = [
    { node: head, stack: [] },
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const frame = frameOf(next.node.callFrame);
    const stack = [...next.stack, frame];
    const bytes = next.node.selfSize;
    if (bytes > 0) {
      allocations.totalBytes += bytes;
      allocations.self.add(frame.key, bytes);
      for (const key of new Set(stack.map((each) => each.key))) {
        allocations.inclusive.add(key, bytes);
      }
      for (const each of stack) {
        allocations.phases.set(each.key, each.phase);
      }
      const chain = stack.slice(-chainDepth).reverse();
      allocations.chains.add(chain.map((each) => each.fn).join(' < '), bytes);
    }
    pending.push(...next.node.children.map((node) => ({ node, stack })));
  }
  return allocations;
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { top: { type: 'string' } },
  });
  const [dir, name] = positionals;
  if (dir === undefined || name === undefined) {
    throw new Error('Usage: allocations.ts <dir> <name> [--top N]');
  }
  const top = values.top === undefined ? defaultTop : Number(values.top);
  const profile = JSON.parse(
    readFileSync(resolve(dir, `${name}.heapprofile`), 'utf8'),
  ) as HeapProfiler.SamplingHeapProfile;
  const allocations = tally(profile.head);
  const size = (bytes: number) => `${(bytes / bytesPerMb).toFixed(1)}MB`.padStart(sizeWidth);
  const format = { whole: allocations.totalBytes, amount: size };
  const list = (title: string, rows: readonly (readonly [string, number])[]) =>
    printList(title, rows, format);
  process.stdout.write(`== ${name}: ${size(allocations.totalBytes).trim()} allocated (sampled)\n`);
  list('self (the allocating function)', allocations.self.top(top));
  const own = allocations.inclusive
    .top(Number.POSITIVE_INFINITY)
    .filter(([key]) => isToolchainPhase(allocations.phases.get(key) ?? ''));
  list('inclusive (toolchain code)', own.slice(0, top));
  list('chains (allocator < its callers)', allocations.chains.top(top));
}

main();
