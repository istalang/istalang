/** Values memoized on a key (memo.ts `memo`) and on a sequence of objects (`SequenceMemo`). */

import { describe, expect, it } from 'vitest';
import { type MemoCache, memo, SequenceMemo } from './memo.ts';

/** A cache counting its lookups. */
function countingCache<Value>(): MemoCache<string, Value> & { lookups: number } {
  const values = new Map<string, Value>();
  return {
    lookups: 0,
    get(key) {
      this.lookups += 1;
      return values.get(key);
    },
    set: (key, value) => values.set(key, value),
  };
}

describe('a value memoized on a key', () => {
  it('is found again with one lookup', () => {
    const cache = countingCache<object>();
    const first = memo(cache, 'k', () => ({}));
    cache.lookups = 0;
    expect(memo(cache, 'k', () => ({}))).toBe(first);
    expect(cache.lookups).toBe(1);
  });

  it('keeps a computed undefined, found again with one lookup', () => {
    const cache = countingCache<undefined>();
    let computed = 0;
    const compute = (): undefined => {
      computed += 1;
    };
    memo(cache, 'k', compute);
    cache.lookups = 0;
    expect(memo(cache, 'k', compute)).toBeUndefined();
    expect(computed).toBe(1);
    expect(cache.lookups).toBe(1);
  });
});

describe('a value memoized on a sequence', () => {
  const [a, b] = [{}, {}];

  it('is computed once for the same objects in the same order', () => {
    const sequences = new SequenceMemo<object, object>();
    const first = sequences.get([a, b], () => ({}));
    expect(sequences.get([a, b], () => ({}))).toBe(first);
  });

  it('is computed again for other objects, another order, or a prefix', () => {
    const sequences = new SequenceMemo<object, object>();
    const first = sequences.get([a, b], () => ({}));
    expect(sequences.get([b, a], () => ({}))).not.toBe(first);
    expect(sequences.get([a], () => ({}))).not.toBe(first);
    expect(sequences.get([a, b, {}], () => ({}))).not.toBe(first);
  });

  it('keeps a value computed for no objects, undefined included', () => {
    const sequences = new SequenceMemo<object, undefined>();
    let computed = 0;
    sequences.get([], () => {
      computed += 1;
    });
    sequences.get([], () => undefined);
    expect(computed).toBe(1);
  });
});
