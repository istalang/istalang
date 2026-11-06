/**
 * Positions in sequences, arrays and strings alike (§3.8, §3.9): what an index, a range, `at` and
 * `slice` select, and when indexing panics. One home, so arrays and strings can't disagree.
 *
 * - `xs[i]` needs `0 <= i < length`; anything else is a bug in the program, so it panics (§3.12).
 * - `at(i)` counts a negative index from the end, as JavaScript does, and gives none outside.
 * - A range's open start means 0 and its open end the length. Slicing with it needs
 *   `0 <= start <= end <= length`, and panics otherwise. A range stepping backward runs from the
 *   last position to before the first, so it needs `-1 <= end <= start < length` (ranges.ts).
 * - `slice(start, end)` clamps instead, a negative index counting from the end, as JavaScript does.
 */

import { Panic } from '../runtime/natives.ts';
import { countOf, type RangeValue, textOf } from './ranges.ts';

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

/**
 * The span `slice(start, end)` selects in a sequence of `length`: clamped, a negative index
 * counting from the end.
 */
export function sliceBounds(
  length: number,
  start: bigint,
  end: bigint | undefined,
): { readonly start: number; readonly end: number } {
  const clamp = (index: bigint) => {
    const shifted = index < 0n ? BigInt(length) + index : index;
    if (shifted <= 0n) {
      return 0;
    }
    return shifted >= BigInt(length) ? length : Number(shifted);
  };
  const from = clamp(start);
  const to = end === undefined ? length : clamp(end);
  return { start: from, end: Math.max(from, to) };
}

/**
 * The items `slice(start, end)` selects of `items`: clamped, a negative index counting from the
 * end.
 */
export function sliced<T>(items: readonly T[], start: bigint, end: bigint | undefined): T[] {
  const bounds = sliceBounds(items.length, start, end);
  return items.slice(bounds.start, bounds.end);
}

/** What a range selects in a sequence: a span between two positions, or every step-th position. */
export type Selection =
  | { readonly kind: 'span'; readonly start: number; readonly end: number }
  | { readonly kind: 'stepped'; readonly positions: readonly number[] };

/**
 * What `range` selects in a sequence of `length` of `what`, which must hold it: with a step of 1,
 * the span from its start to its end; with any other, every step-th position from its start. The
 * open ends default by the step's direction: from 0 to the length forward, from the last position
 * to before the first backward.
 */
export function selectionOf(range: RangeValue, length: number, what: string): Selection {
  const size = BigInt(length);
  const forward = range.step > 0n;
  const start = range.start ?? (forward ? 0n : size - 1n);
  const end = range.end ?? (forward ? size : -1n);
  const inside = forward
    ? start >= 0n && start <= end && end <= size
    : -1n <= end && end <= start && start < size;
  if (!inside) {
    const resolved = textOf({ start, end, step: range.step });
    throw new Panic(`The range ${resolved} is out of range for ${what} of length ${length}.`);
  }
  if (range.step === 1n) {
    return { kind: 'span', start: Number(start), end: Number(end) };
  }
  const count = Number(countOf({ start, end, step: range.step }));
  const positions = Array.from({ length: count }, (_, index) => start + BigInt(index) * range.step);
  return { kind: 'stepped', positions: positions.map(Number) };
}

/** The items of `items` that `selection` selects, in its order. */
export function selected<T>(items: readonly T[], selection: Selection): T[] {
  if (selection.kind === 'span') {
    return items.slice(selection.start, selection.end);
  }
  return selection.positions.map((position) => items[position] as T);
}

/**
 * `items` with what `selection` selects replaced by `replacement`: a span by any number of items,
 * every step-th position by exactly as many as it selects, one each.
 */
export function replaced<T>(
  items: readonly T[],
  selection: Selection,
  replacement: readonly T[],
): T[] {
  if (selection.kind === 'span') {
    return items.toSpliced(selection.start, selection.end - selection.start, ...replacement);
  }
  const { positions } = selection;
  if (replacement.length !== positions.length) {
    throw new Panic(
      `A stepped slice of ${positions.length} items can't be replaced by ${replacement.length}.`,
    );
  }
  const changed = [...items];
  for (const [index, position] of positions.entries()) {
    changed[position] = replacement[index] as T;
  }
  return changed;
}
