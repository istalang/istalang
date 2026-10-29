/** Values memoized on a sequence of objects (memo.ts `SequenceMemo`). */

import { describe, expect, it } from 'vitest';
import { SequenceMemo } from './memo.ts';

describe('a value memoized on a sequence', () => {
  const [a, b] = [{}, {}];

  it('is computed once for the same objects in the same order', () => {
    const memo = new SequenceMemo<object, object>();
    const first = memo.get([a, b], () => ({}));
    expect(memo.get([a, b], () => ({}))).toBe(first);
  });

  it('is computed again for other objects, another order, or a prefix', () => {
    const memo = new SequenceMemo<object, object>();
    const first = memo.get([a, b], () => ({}));
    expect(memo.get([b, a], () => ({}))).not.toBe(first);
    expect(memo.get([a], () => ({}))).not.toBe(first);
    expect(memo.get([a, b, {}], () => ({}))).not.toBe(first);
  });

  it('keeps a value computed for no objects, undefined included', () => {
    const memo = new SequenceMemo<object, undefined>();
    let computed = 0;
    memo.get([], () => {
      computed += 1;
    });
    memo.get([], () => undefined);
    expect(computed).toBe(1);
  });
});
