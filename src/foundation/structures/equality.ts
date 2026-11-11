/**
 * Equality of results, for deciding whether a value computed again is the one computed before
 * (entries/, early cutoff). Items compare by a given equality, by identity unless told otherwise,
 * so nodes and entities, whose identity is their meaning, compare as themselves. A collection is
 * equal to itself without a look inside: a revision replays many reads answered by the very object
 * they answered before.
 */

/** An equality on values of one kind. */
export type Equality<Value> = (first: Value, second: Value) => boolean;

/** Whether two lists hold equal items in the same order, items compared by `items`. */
export function sameItems<Item>(items: Equality<Item> = Object.is): Equality<readonly Item[]> {
  return (first, second) =>
    first === second ||
    (first.length === second.length &&
      first.every((item, index) => items(item, second[index] as Item)));
}

/** Whether two maps hold equal values under the same keys, values compared by `values`. */
export function sameEntries<Key, Value>(
  values: Equality<Value> = Object.is,
): Equality<ReadonlyMap<Key, Value>> {
  return (first, second) =>
    first === second ||
    (first.size === second.size &&
      [...first].every(
        ([key, value]) => second.has(key) && values(value, second.get(key) as Value),
      ));
}

/** Whether two sets hold the same members. */
export function sameMembers<Member>(
  first: ReadonlySet<Member>,
  second: ReadonlySet<Member>,
): boolean {
  return (
    first === second ||
    (first.size === second.size && [...first].every((member) => second.has(member)))
  );
}

/** Whether two records hold identical values under the same keys: records of nodes and entities. */
export function sameProperties<Value extends object>(first: Value, second: Value): boolean {
  const keys = Object.keys(first) as (keyof Value)[];
  return (
    keys.length === Object.keys(second).length &&
    keys.every((key) => Object.is(first[key], second[key]))
  );
}

/** `items` with each one equal to one before it, by `same`, left out: the first of each, in order. */
export function distinctItems<Item>(
  items: readonly Item[],
  same: Equality<Item> = Object.is,
): readonly Item[] {
  return items.filter((item, index) => items.findIndex((each) => same(each, item)) === index);
}
