/**
 * Deploying a Definition (§5): it is stored once by hash, however many times a runtime deploys it,
 * and a fresh runtime on the same store still gets it written when its store lacks it.
 */

import { describe, expect, it } from 'vitest';
import { subsetDefinition, subsetOutcome } from '../../test/definitions/subset.ts';
import { definitionFormat } from '../definition/definition.ts';
import { preludeNatives } from '../stdlib/prelude/natives.ts';
import { testRuntime } from './runtime.test-kit.ts';
import { memoryStore } from './store.ts';

const { text } = definitionFormat.write(subsetDefinition);

function countingStore() {
  const inner = memoryStore();
  const writes: string[] = [];
  return {
    writes,
    store: {
      ...inner,
      commits: [],
      writeDefinition: (hash: string, body: string) => {
        writes.push(hash);
        inner.writeDefinition(hash, body);
      },
    },
  };
}

describe('deploying a Definition', () => {
  it('writes it to the store once, however often the same runtime deploys it', () => {
    const { store, writes } = countingStore();
    const { runtime } = testRuntime({ natives: preludeNatives, store });
    const first = runtime.deploy(text);
    const second = runtime.deploy(text);
    expect(writes).toEqual([first.hash]);
    expect(second.hash).toBe(first.hash);
    expect(second.start('again')).toEqual({ kind: 'finished', outcome: subsetOutcome });
  });

  it('writes it again for a fresh runtime whose store lacks it', () => {
    const one = countingStore();
    const two = countingStore();
    testRuntime({ natives: preludeNatives, store: one.store }).runtime.deploy(text);
    testRuntime({ natives: preludeNatives, store: two.store }).runtime.deploy(text);
    expect([one.writes.length, two.writes.length]).toEqual([1, 1]);
  });
});
