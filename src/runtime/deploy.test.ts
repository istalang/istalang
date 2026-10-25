/**
 * Deploying a Definition (§5): it is stored once by hash, however many times a runtime deploys it,
 * and a fresh runtime on the same store still gets it written when its store lacks it.
 */

import { describe, expect, it } from 'vitest';
import { subsetDefinition, subsetOutcome } from '../../test/definitions/subset.ts';
import { definitionFormat } from '../definition/definition.ts';
import { preludeNatives } from '../stdlib/prelude/natives.ts';
import { recordingStore, testRuntime } from './runtime.test-kit.ts';

const { text } = definitionFormat.write(subsetDefinition);

describe('deploying a Definition', () => {
  it('writes it to the store once, however often the same runtime deploys it', () => {
    const store = recordingStore();
    const { runtime } = testRuntime({ natives: preludeNatives, store });
    const first = runtime.deploy(text);
    const second = runtime.deploy(text);
    expect(store.definitions).toEqual([first.hash]);
    expect(second.hash).toBe(first.hash);
    expect(second.start('again').state).toEqual({ kind: 'finished', outcome: subsetOutcome });
  });

  it('writes it again for a fresh runtime whose store lacks it', () => {
    const one = recordingStore();
    const two = recordingStore();
    testRuntime({ natives: preludeNatives, store: one }).runtime.deploy(text);
    testRuntime({ natives: preludeNatives, store: two }).runtime.deploy(text);
    expect([one.definitions.length, two.definitions.length]).toEqual([1, 1]);
  });
});
