/** Values memoized for one revision of an owner that changes in place (`RevisionMemo`). */

import { describe, expect, it } from 'vitest';
import { RevisionMemo } from './revision-memo.ts';

describe('a value memoized for a revision', () => {
  it('is computed once while the revision stands', () => {
    const values = new RevisionMemo<string, object>();
    let computed = 0;
    const compute = () => {
      computed += 1;
      return {};
    };
    const first = values.get(1, 'k', compute, {});
    expect(values.get(1, 'k', compute, {})).toBe(first);
    expect(computed).toBe(1);
  });

  it('is computed again at another revision, as is every other key', () => {
    const values = new RevisionMemo<string, number>();
    values.get(1, 'a', () => 1, 0);
    values.get(1, 'b', () => 2, 0);
    expect(values.get(2, 'a', () => 10, 0)).toBe(10);
    expect(values.get(2, 'b', () => 20, 0)).toBe(20);
  });

  it('keeps a computed undefined', () => {
    const values = new RevisionMemo<string, number | undefined>();
    let computed = 0;
    const compute = (): undefined => {
      computed += 1;
    };
    values.get(1, 'k', compute, 0);
    expect(values.get(1, 'k', compute, 0)).toBeUndefined();
    expect(computed).toBe(1);
  });

  it('answers the stand-in for every member of a cycle, whichever was asked first', () => {
    const answers = (first: string, second: string) => {
      const values = new RevisionMemo<string, string>();
      const reads = new Map([
        ['a', 'b'],
        ['b', 'a'],
      ]);
      const read = (key: string): string =>
        values.get(1, key, () => `${key}(${read(reads.get(key) ?? key)})`, 'cycle');
      return { [first]: read(first), [second]: read(second) };
    };
    expect(answers('a', 'b')).toEqual({ a: 'cycle', b: 'cycle' });
    expect(answers('b', 'a')).toEqual({ a: 'cycle', b: 'cycle' });
  });

  it('keeps nothing a member computed from a stand-in, even where it falls back from it', () => {
    const answers = (first: string, second: string) => {
      const values = new RevisionMemo<string, string | undefined>();
      const computes = new Map<string, () => string | undefined>([
        ['a', () => read('b') ?? 'ok'],
        ['b', () => read('a')],
      ]);
      const read = (key: string): string | undefined =>
        values.get(1, key, computes.get(key) ?? (() => undefined), undefined);
      return { [first]: read(first), [second]: read(second) };
    };
    expect(answers('a', 'b')).toEqual({ a: undefined, b: undefined });
    expect(answers('b', 'a')).toEqual({ a: undefined, b: undefined });
  });

  it('answers the stand-in for a key reading itself', () => {
    const values = new RevisionMemo<string, string>();
    const read = (): string => values.get(1, 'a', () => `a(${read()})`, 'cycle');
    expect(read()).toBe('cycle');
  });

  it('computes a key outside a cycle from the stand-in, whichever was asked first', () => {
    const answers = (first: string) => {
      const values = new RevisionMemo<string, string>();
      const reads = new Map([
        ['c', 'a'],
        ['a', 'b'],
        ['b', 'a'],
      ]);
      const read = (key: string): string =>
        values.get(1, key, () => `${key}(${read(reads.get(key) ?? key)})`, 'cycle');
      read(first);
      return ['a', 'b', 'c'].map(read);
    };
    expect(answers('c')).toEqual(['cycle', 'cycle', 'c(cycle)']);
    expect(answers('a')).toEqual(['cycle', 'cycle', 'c(cycle)']);
  });
});
