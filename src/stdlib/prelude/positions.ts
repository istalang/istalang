/**
 * Positions in sequences, arrays and strings alike (§3.8, §3.9): what an index, a range, `at` and
 * `slice` select, and when indexing panics. One home, so arrays and strings can't disagree.
 *
 * - `xs[i]` needs `0 <= i < length`; anything else is a bug in the program, so it panics (§3.12).
 * - `at(i)` counts a negative index from the end, as JavaScript does, and gives none outside.
 * - A range's open start means 0 and its open end the length. Slicing with it needs
 *   `0 <= start <= end <= length`, and panics otherwise.
 * - `slice(start, end)` clamps instead, a negative index counting from the end, as JavaScript does.
 * - Iterating a range needs both ends; it gives nothing when the start isn't below the end.
 */

import type { Value } from '../../definition/values.ts';
import { Panic } from '../../runtime/natives.ts';
import { fieldOf, int, optionalValue } from '../native-values.ts';

/** The position `key` names in a sequence of `length` of `what`, which must hold it. */
export function checkedIndex(key: bigint, length: number, what: string): number {
  if (key < 0n || key >= BigInt(length)) {
    throw new Panic(`Index ${key} is out of range for ${what} of length ${length}.`);
  }
  return Number(key);
}

/** The position `at(key)` reads, counting a negative key from the end; undefined outside. */
export function atPosition(key: bigint, length: number): number | undefined {
  const position = key < 0n ? BigInt(length) + key : key;
  return position >= 0n && position < BigInt(length) ? Number(position) : undefined;
}

/** The start and end of the span `range` selects in a sequence of `length` of `what`. */
export function spanOf(range: Value, length: number, what: string): readonly [number, number] {
  const { start = 0n, end = BigInt(length) } = rangeEnds(range);
  if (start < 0n || start > end || end > BigInt(length)) {
    throw new Panic(`The range ${start}..${end} is out of range for ${what} of length ${length}.`);
  }
  return [Number(start), Number(end)];
}

/** The ints a range with both ends covers, in order. */
export function rangeInts(range: Value): readonly bigint[] {
  const { start, end } = rangeEnds(range);
  if (start === undefined || end === undefined) {
    throw new Panic("A range without both ends can't be iterated.");
  }
  return Array.from(
    { length: Math.max(0, Number(end - start)) },
    (_, offset) => start + BigInt(offset),
  );
}

/** The ends a prelude `Range` holds (§3.8): its `start` and `end` fields, each optional. */
function rangeEnds(range: Value): { readonly start?: bigint; readonly end?: bigint } {
  const [start, end] = [0, 1].map((index) => optionalValue(fieldOf(range, index)));
  return {
    ...(start === undefined ? {} : { start: int(start) }),
    ...(end === undefined ? {} : { end: int(end) }),
  };
}
