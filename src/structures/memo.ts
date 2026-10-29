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

/**
 * Values each derived from a sequence of objects, such as a module's items: the same objects in the
 * same order find a value again, and a value goes once one of its objects is collected.
 */
export class SequenceMemo<Item extends object, Value> {
  readonly #root: SequenceNode<Item, Value> = { next: new WeakMap() };

  /** The value `compute` gives for `items`, computed the first time they are asked for. */
  get(items: readonly Item[], compute: () => Value): Value {
    let node = this.#root;
    for (const item of items) {
      node = memo(node.next, item, () => ({ next: new WeakMap() }));
    }
    node.found ??= { value: compute() };
    return node.found.value;
  }
}

/** One step of a sequence: the steps after it, and the value of the sequence ending at it. */
interface SequenceNode<Item extends object, Value> {
  readonly next: WeakMap<Item, SequenceNode<Item, Value>>;
  found?: { readonly value: Value };
}
