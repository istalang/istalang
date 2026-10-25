/**
 * Maps as values (§3.8): entries in the order their keys were first set, keys found by the
 * built-in `==` (equality.ts, `entryPosition`). A map is immutable like every value, so setting or
 * deleting a key builds a new map.
 */

import type { Value } from '../../definition/values.ts';
import { carryTable, entryPosition, type MapValue } from './equality.ts';

/** `map` with `key` set to `value`: a key it holds keeps its place, a new one goes last. */
export function withEntry(map: MapValue, key: Value, value: Value): MapValue {
  const position = entryPosition(map, key);
  const entry: [Value, Value] = [key, value];
  const next: MapValue = {
    kind: 'map',
    entries: position === undefined ? [...map.entries, entry] : map.entries.with(position, entry),
  };
  carryTable(map, next, key);
  return next;
}

/** `map` without `key`'s entry. */
export function withoutEntry(map: MapValue, key: Value): MapValue {
  const position = entryPosition(map, key);
  return position === undefined
    ? map
    : { kind: 'map', entries: map.entries.toSpliced(position, 1) };
}

/** A map of `entries` in order, a later entry of an equal key replacing the earlier's value. */
export function mapOf(entries: readonly (readonly [Value, Value])[]): MapValue {
  return entries.reduce<MapValue>((map, [key, value]) => withEntry(map, key, value), {
    kind: 'map',
    entries: [],
  });
}
