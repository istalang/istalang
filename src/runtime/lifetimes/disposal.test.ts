/**
 * Which objects are disposed when nothing holds them (§7): those whose disposal can be seen by what
 * it does; any other is gone at once. A weak reference only observes, so it changes neither.
 */

import { describe, expect, it } from 'vitest';
import { testHeap } from '../scheduler/instance/heap.test-kit.ts';
import type { LiveObject } from '../scheduler/instance/heap.ts';
import { isDisposable } from './disposal.ts';
import { testTypes } from './lifetimes.test-kit.ts';

/** Whether `object`, alone in a heap or beside a weak reference to it, is disposed. */
function disposed(object: LiveObject, watched: boolean): boolean {
  const weak: LiveObject = { kind: 'weakRef', id: 1, target: 0 };
  const heap = testHeap(watched ? [object, weak] : [object]);
  return isDisposable({ heap, types: testTypes }, object);
}

describe('disposability', () => {
  it.each<[string, LiveObject, boolean]>([
    ['a call future', { kind: 'future', id: 0, state: { kind: 'call' } }, true],
    [
      'a pending take',
      {
        kind: 'future',
        id: 0,
        state: { kind: 'slot', slot: 2, operation: 'take', givenUp: false },
      },
      true,
    ],
    [
      'a future its host fills',
      { kind: 'future', id: 0, state: { kind: 'host', token: 't' } },
      true,
    ],
    ['a cell whose type declares dispose', { kind: 'cell', id: 0, type: 0, value: null }, true],
    [
      'a resolved future',
      { kind: 'future', id: 0, state: { kind: 'resolved', value: null } },
      false,
    ],
    ['a timer', { kind: 'future', id: 0, state: { kind: 'timer', at: 0n } }, false],
    ['a run', { kind: 'run', id: 0, function: 0, captures: [], arguments: [] }, false],
    ['a slot', { kind: 'slot', id: 0, waiting: [] }, false],
    ['a plain cell', { kind: 'cell', id: 0, type: 1, value: null }, false],
  ])('disposes %s: %s, whether a weak reference refers to it or not', (_case, object, expected) => {
    expect(disposed(object, false)).toBe(expected);
    expect(disposed(object, true)).toBe(expected);
  });
});
