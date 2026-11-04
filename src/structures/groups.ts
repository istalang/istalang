/**
 * Groups of items kept per key, filled one item at a time: the positions under each hash, the
 * patches waiting on a label, the edges leaving a node. Each item joins its group in place, so
 * filling a group costs one push per item. A list grouped whole, by a key every item has, is
 * `Map.groupBy`'s.
 */

/** Adds `item` to the end of the group `groups` keeps under `key`, starting the group with it. */
export function addToGroup<Key, Item>(groups: Map<Key, Item[]>, key: Key, item: Item): void {
  const group = groups.get(key);
  if (group === undefined) {
    groups.set(key, [item]);
  } else {
    group.push(item);
  }
}
