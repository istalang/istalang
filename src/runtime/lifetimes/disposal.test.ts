/**
 * Which objects are disposed when nothing holds them (§7): those whose disposal can be seen, by
 * what it does or by a weak reference to them; any other is left out of the next commit.
 */

import { describe, expect, it } from 'vitest';
import { Heap, type LiveObject } from '../scheduler/heap.ts';
import { isDisposable } from './disposal.ts';
import { testTypes } from './lifetimes.test-kit.ts';

/** Whether `object`, alone in a heap or beside a weak reference to it, is disposed. */
function disposed(object: LiveObject, watched: boolean): boolean {
  const weak: LiveObject = { kind: 'weakRef', id: 1, target: 0 };
  const heap = new Heap(watched ? [object, weak] : [object]);
  return isDisposable({ heap, types: testTypes }, object);
}

describe('disposability', () => {
  it.each<[string, LiveObject, boolean]>([
    ['a call future', { kind: 'future', id: 0, state: { kind: 'call' } }, true],
    [
      'a pending take',
      { kind: 'future', id: 0, state: { kind: 'slot', slot: 2, operation: 'take' } },
      true,
    ],
    [
      'a future its host fills',
      { kind: 'future', id: 0, state: { kind: 'host', token: 't' } },
      true,
    ],
    ['a guard', { kind: 'guard', id: 0, callback: null }, true],
    ['a cell whose type declares dispose', { kind: 'cell', id: 0, type: 0, value: null }, true],
    [
      'a resolved future',
      { kind: 'future', id: 0, state: { kind: 'resolved', value: null } },
      false,
    ],
    ['a timer', { kind: 'future', id: 0, state: { kind: 'timer', at: 0n } }, false],
    ['a first', { kind: 'future', id: 0, state: { kind: 'first', futures: [2] } }, false],
    ['a slot', { kind: 'slot', id: 0, waiting: [] }, false],
    ['a plain cell', { kind: 'cell', id: 0, type: 1, value: null }, false],
  ])('disposes %s unwatched: %s', (_case, object, expected) => {
    expect(disposed(object, false)).toBe(expected);
  });

  it.each<[string, LiveObject]>([
    ['a resolved future', { kind: 'future', id: 0, state: { kind: 'resolved', value: null } }],
    ['a timer', { kind: 'future', id: 0, state: { kind: 'timer', at: 0n } }],
    ['a slot', { kind: 'slot', id: 0, waiting: [] }],
  ])('disposes %s a weak reference refers to', (_case, object) => {
    expect(disposed(object, true)).toBe(true);
  });
});
