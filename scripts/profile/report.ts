/**
 * What the profile reports (analyze.ts, allocations.ts) share: totals by key, which frames are the
 * toolchain's own, and one way of printing a ranked list, each row's share of the whole first.
 */

import process from 'node:process';

/** Totals by key, largest first on request. */
export class Tally extends Map<string, number> {
  add(key: string, amount: number): void {
    this.set(key, (this.get(key) ?? 0) + amount);
  }

  top(limit: number): readonly (readonly [string, number])[] {
    return [...this].sort((first, second) => second[1] - first[1]).slice(0, limit);
  }
}

/** Phases outside the toolchain's own code (cpu-profile.ts): the runtime's, V8's, dependencies'. */
const foreignPhases = new Set(['node-builtin', 'node_modules', 'v8/native']);

/** Whether frames of `phase` are the toolchain's own code. */
export function isToolchainPhase(phase: string): boolean {
  return !foreignPhases.has(phase);
}

/** How a ranked list prints its rows: the whole the shares are of, and each row's amount. */
export interface ListFormat {
  readonly whole: number;
  readonly amount: (value: number) => string;
  /** A column between the amount and the key, such as a call count. */
  readonly detail?: (key: string) => string;
}

const percent = 100;
const shareWidth = 6;

/** Prints `rows` under `title`, each as its share of the whole, its amount, and its key. */
export function printList(
  title: string,
  rows: readonly (readonly [string, number])[],
  format: ListFormat,
): void {
  process.stdout.write(`-- ${title}\n`);
  for (const [key, value] of rows) {
    const share = `${((value * percent) / (format.whole || 1)).toFixed(1)}%`.padStart(shareWidth);
    const detail = format.detail === undefined ? '' : ` ${format.detail(key)}`;
    process.stdout.write(`${share} ${format.amount(value)}${detail}  ${key}\n`);
  }
}
