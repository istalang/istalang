/**
 * A sweep too long for one test file runs in slices, a file each, so vitest runs them in workers
 * side by side and no file holds the suite's wall clock. A slice is `<sweep>-<n>.sweep.test.ts`;
 * the files beside it of the same `<sweep>` are the other slices, so slicing finer is adding a
 * file. Items are dealt round the slices in order, so the heavy ones of a group spread.
 */

import { readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sliceName = /^(?<sweep>.+)-(?<number>\d+)\.sweep\.test\.ts$/u;

/** A slice of a sweep, by its place among the sweep's slices. */
export interface Slice {
  /** Its place among the slices, from 0. */
  readonly index: number;
  /** Of `items`, those the slice runs: the `index`-th of each round dealt. */
  readonly of: <T>(items: readonly T[]) => readonly T[];
}

/** The slice that the test file `file` (its `import.meta.url`) is. */
export function sliceOf(file: string): Slice {
  const path = fileURLToPath(file);
  const { sweep, number } = parsed(basename(path));
  const numbers = readdirSync(dirname(path))
    .flatMap((name) => {
      const sibling = sliceName.exec(name)?.groups;
      return sibling?.sweep === sweep ? [Number(sibling.number)] : [];
    })
    .toSorted((first, second) => first - second);
  const index = numbers.indexOf(number);
  return { index, of: (items) => items.filter((_, at) => at % numbers.length === index) };
}

function parsed(name: string): { readonly sweep: string; readonly number: number } {
  const groups = sliceName.exec(name)?.groups;
  if (groups?.sweep === undefined) {
    throw new Error(`${name} isn't named as a slice, <sweep>-<n>.sweep.test.ts`);
  }
  return { sweep: groups.sweep, number: Number(groups.number) };
}
