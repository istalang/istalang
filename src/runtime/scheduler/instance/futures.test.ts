/**
 * Futures (spec §3.8, §6): a future resolves once, and a host's answer to no future pending on it
 * makes nothing of its value.
 */

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

  it("make a host's answer only for a future pending on the host", () => {
    const futures = freshFutures();
    const { token } = futures.createFilled(String);
    const made: string[] = [];
    const value = (name: string) => () => {
      made.push(name);
      return null;
    };
    expect(futures.resolveHost('elsewhere', value('elsewhere'))).toBe(false);
    expect(futures.resolveHost(token, value('waited'))).toBe(true);
    expect(futures.resolveHost(token, value('again'))).toBe(false);
    expect(made).toEqual(['waited']);
  });
});
