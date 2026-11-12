/** Futures (spec §3.8, §6): a future resolves once. */

import { describe, expect, it } from 'vitest';
import { Unreachable } from '../../../foundation/structures/unreachable.ts';
import { futuresOn } from './futures.test-kit.ts';
import { testHeap } from './heap.test-kit.ts';

function freshFutures() {
  return futuresOn(testHeap());
}

describe('futures', () => {
  it('resolve once', () => {
    const futures = freshFutures();
    const id = futures.create({ kind: 'timer', at: 5n });
    futures.resolve(id, null);
    expect(() => futures.resolve(id, null)).toThrow(Unreachable);
  });
});
