/**
 * Searching items kept in order. Positions in a text (line starts, tokens) are looked up on every
 * keystroke an editor sends, so they are bisected, never scanned.
 */

/**
 * The index of the last of `items`, in ascending order of `keyOf`, whose key is at most `value`;
 * -1 when none is.
 */
export function lastIndexAtMost<Item>(
  items: readonly Item[],
  keyOf: (item: Item) => number,
  value: number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const item = items[middle];
    if (item !== undefined && keyOf(item) <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low - 1;
}
