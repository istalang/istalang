/**
 * The built-in `==` (§3.9): values compare by structure, handles by identity (§3.1). It can't be
 * overloaded, which keeps it consistent for map keys, and finding a map's key by it lives here.
 *
 * Primitives compare as JavaScript does, so a float `NaN` equals nothing, IEEE 754's rule, and
 * `0.0 == -0.0`. A composite compares its head (kind, type, variant, function or object), then its
 * parts in order, except a map, whose order of entries is no part of its value (§3.8): two maps
 * are equal when they hold equal values for equal keys.
 */

import {
  type CompositeValue,
  childValues,
  isComposite,
  type Value,
} from '../../definition/values.ts';

export function valuesEqual(left: Value, right: Value): boolean {
  if (!(isComposite(left) && isComposite(right))) {
    return left === right;
  }
  if (!sameHead(left, right)) {
    return false;
  }
  if (left.kind === 'map' && right.kind === 'map') {
    return (
      left.entries.length === right.entries.length &&
      left.entries.every(([key, value]) => {
        const other = entryValue(right, key);
        return other !== undefined && valuesEqual(value, other);
      })
    );
  }
  const leftParts = childValues(left);
  const rightParts = childValues(right);
  return (
    leftParts.length === rightParts.length &&
    leftParts.every((part, index) => {
      const other = rightParts[index];
      return other !== undefined && valuesEqual(part, other);
    })
  );
}

/** Whether two composites agree on everything but their parts. */
function sameHead(left: CompositeValue, right: CompositeValue): boolean {
  switch (left.kind) {
    case 'handle':
      return right.kind === 'handle' && left.object === right.object;
    case 'extern':
      return right.kind === 'extern' && left.type === right.type && left.payload === right.payload;
    case 'struct':
      return right.kind === 'struct' && left.type === right.type;
    case 'variant':
      return right.kind === 'variant' && left.type === right.type && left.variant === right.variant;
    case 'closure':
      return right.kind === 'closure' && left.function === right.function;
    default:
      return left.kind === right.kind;
  }
}

/**
 * Finding a map's key goes through a hash of its structure (`structuralKey`), then confirms with
 * `==`, so a lookup agrees with `==` exactly: a key holding a NaN is stored but never found again,
 * since NaN equals nothing. A map's hash table is derived from it once and kept beside it, keyed
 * by the map value itself, which never changes. A map built from another by setting one key takes
 * the other's table over (`carryTable`), so building a map key by key never hashes a key twice.
 */

export type MapValue = Extract<Value, { kind: 'map' }>;

/** A key's structure as text: values `==` calls equal give the same text. */
export function structuralKey(value: Value): string {
  if (!isComposite(value)) {
    // `-0 == 0`, and `String(-0)` is `'0'`; a NaN gives `'NaN'`, which `==` then refuses.
    return `${typeof value}:${typeof value === 'string' ? JSON.stringify(value) : String(value)}`;
  }
  switch (value.kind) {
    case 'handle':
      return `handle:${value.object}`;
    case 'extern':
      return `extern:${value.type}`;
    case 'map':
      return `map(${value.entries
        .map(([key, entry]) => `${structuralKey(key)}=${structuralKey(entry)}`)
        .toSorted(byCodeUnits)
        .join(',')})`;
    default:
      return `${value.kind}${headOf(value)}(${childValues(value).map(structuralKey).join(',')})`;
  }
}

/**
 * Orders texts by their code units, so the order is the same for any two equal texts and differs
 * for any two different ones; a locale's order may call different texts equal.
 */
function byCodeUnits(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  return first > second ? 1 : 0;
}

/** What a composite with parts is besides its parts: its type, variant or function. */
function headOf(value: CompositeValue): string {
  switch (value.kind) {
    case 'struct':
      return String(value.type);
    case 'variant':
      return `${value.type}.${value.variant}`;
    case 'closure':
      return String(value.function);
    default:
      return '';
  }
}

const tables = new WeakMap<MapValue, ReadonlyMap<string, readonly number[]>>();

/** The positions of `map`'s entries by their key's structural key. */
function tableOf(map: MapValue): ReadonlyMap<string, readonly number[]> {
  const known = tables.get(map);
  if (known !== undefined) {
    return known;
  }
  const table = new Map<string, number[]>();
  map.entries.forEach(([key], position) => {
    const text = structuralKey(key);
    table.set(text, [...(table.get(text) ?? []), position]);
  });
  tables.set(map, table);
  return table;
}

/** The position of `key`'s entry in `map`; undefined when `map` has no such key. */
export function entryPosition(map: MapValue, key: Value): number | undefined {
  return tableOf(map)
    .get(structuralKey(key))
    ?.find((position) => valuesEqual(map.entries[position]?.[0] ?? null, key));
}

/** The value `map` holds for `key`; undefined when it holds none. */
export function entryValue(map: MapValue, key: Value): Value | undefined {
  const position = entryPosition(map, key);
  return position === undefined ? undefined : map.entries[position]?.[1];
}

/**
 * Gives `next`, built from `map` by setting `key`, a table derived from `map`'s, if `map` has one:
 * the same table when `key` replaced a value, else that table with `key` added at the end.
 */
export function carryTable(map: MapValue, next: MapValue, key: Value): void {
  const table = tables.get(map);
  if (table === undefined || next.entries.length === map.entries.length) {
    if (table !== undefined) {
      tables.set(next, table);
    }
    return;
  }
  const text = structuralKey(key);
  const extended = new Map(table);
  extended.set(text, [...(table.get(text) ?? []), next.entries.length - 1]);
  tables.set(next, extended);
}
