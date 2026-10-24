/**
 * Computing a value once per key (architecture, "State: derive, never mirror"): every derived result
 * is memoized on the immutable input it derives from, so a new input is a new key and nothing is
 * ever invalidated by hand. A computed `undefined` is remembered like any other value.
 */

/** What `memo` keeps values in: a `Map`, or a `WeakMap` when the key's lifetime should decide. */
export interface MemoCache<Key, Value> {
  readonly has: (key: Key) => boolean;
  readonly get: (key: Key) => Value | undefined;
  readonly set: (key: Key, value: Value) => unknown;
}

/** The value `compute` gives for `key`, computed the first time and remembered in `cache`. */
export function memo<Key, Value>(
  cache: MemoCache<Key, Value>,
  key: Key,
  compute: () => Value,
): Value {
  if (cache.has(key)) {
    return cache.get(key) as Value;
  }
  const value = compute();
  cache.set(key, value);
  return value;
}
