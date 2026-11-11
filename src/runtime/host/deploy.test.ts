/**
 * Deploying a Definition (§5): it is stored once by hash, however many times a runtime deploys it,
 * and a fresh runtime on the same store still gets it written when its store lacks it. A deploy
 * refused before it stored the Definition stores it when tried again, and a text is read once,
 * though the store gives back its canonical text.
 */

import { describe, expect, it, vi } from 'vitest';
import { subsetDefinition, subsetOutcome } from '../../../test/definitions/subset.ts';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { recordingStore, testRuntime } from '../runtime.test-kit.ts';

const { text } = definitionFormat.write(subsetDefinition);

/** A program an instance can run: its ista body, the subset's `main` being live code. */
const instanceText = compiledText(
  "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: 1",
);

describe('deploying a Definition', () => {
  it('writes it to the store once, however often the same runtime deploys it', async () => {
    const store = recordingStore();
    const { runtime } = testRuntime({ natives: stdNatives, store });
    const first = runtime.deploy(text);
    const second = runtime.deploy(text);
    expect(store.definitions).toEqual([first.hash]);
    expect(second.hash).toBe(first.hash);
    expect((await second.start('again')).state).toEqual({
      kind: 'finished',
      outcome: subsetOutcome,
    });
  });

  it('writes it again for a fresh runtime whose store lacks it', () => {
    const one = recordingStore();
    const two = recordingStore();
    testRuntime({ natives: stdNatives, store: one }).runtime.deploy(text);
    testRuntime({ natives: stdNatives, store: two }).runtime.deploy(text);
    expect([one.definitions.length, two.definitions.length]).toEqual([1, 1]);
  });

  it('writes it when deployed again after a deploy that failed before writing it', () => {
    const store = recordingStore();
    let failing = true;
    const flaky = {
      ...store,
      readExterns: () => {
        if (failing) {
          failing = false;
          throw new Error('The store is unavailable.');
        }
        return store.readExterns();
      },
    };
    const { runtime } = testRuntime({ natives: stdNatives, store: flaky });
    expect(() => runtime.deploy(text)).toThrow('The store is unavailable.');
    const program = runtime.deploy(text);
    expect(store.definitions).toEqual([program.hash]);
  });

  it('reads a text once, though the store gives back its canonical text', () => {
    const reads = vi.spyOn(definitionFormat, 'readCanonical');
    try {
      const { runtime, startInstance } = testRuntime({ natives: stdNatives });
      startInstance(` ${instanceText}`, 'spaced');
      runtime.inspect('spaced');
      expect(reads).toHaveBeenCalledTimes(1);
    } finally {
      reads.mockRestore();
    }
  });
});
