/**
 * Deploying a Definition (§5): it is stored once by hash, however many times a runtime deploys it,
 * and a fresh runtime on the same store still gets it written when its store lacks it. A deploy
 * failing before it stored the Definition stores it when tried again, and a runtime reads a stored
 * Definition once, however many of its instances it reads back.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { recordingStore, startToEnd, testRuntime } from '../runtime.test-kit.ts';

/** A program whose live `main` runs its ista body in the context named after the run. */
const encoded = compiledEncoded(
  lines(
    "import * as runtime from 'runtime'",
    "import * as time from 'time'",
    'ista async fn waiting() -> Int:',
    '  await time.delay(1s)',
    '  2',
    'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
    'ista async fn _main() -> Int:',
    '  drop spawn waiting()',
    '  1',
  ),
);

describe('deploying a Definition', () => {
  it('writes it to the store once, however often the same runtime deploys it', async () => {
    const store = recordingStore();
    const { runtime } = testRuntime({ store });
    const first = runtime.deploy(encoded);
    const second = runtime.deploy(encoded);
    expect(store.definitions).toEqual([first.hash]);
    expect(second.hash).toBe(first.hash);
    expect((await second.start('again')).state).toMatchObject({ kind: 'finished', outcome: 1n });
  });

  it('writes it again for a fresh runtime whose store lacks it', () => {
    const one = recordingStore();
    const two = recordingStore();
    testRuntime({ store: one }).runtime.deploy(encoded);
    testRuntime({ store: two }).runtime.deploy(encoded);
    expect([one.definitions.length, two.definitions.length]).toEqual([1, 1]);
  });

  it('writes it when deployed again after a deploy that failed before writing it', () => {
    const store = recordingStore();
    let failing = true;
    const flaky = {
      ...store,
      writeDefinition: (hash: string, bytes: Uint8Array) => {
        if (failing) {
          failing = false;
          throw new Error('The store is unavailable.');
        }
        store.writeDefinition(hash, bytes);
      },
    };
    const { runtime } = testRuntime({ store: flaky });
    expect(() => runtime.deploy(encoded)).toThrow('The store is unavailable.');
    const program = runtime.deploy(encoded);
    expect(store.definitions).toEqual([program.hash]);
  });

  it('reads a stored Definition once, however many of its instances a fresh runtime reads back', async () => {
    const first = testRuntime();
    expect(await startToEnd(first, encoded)).toEqual({ kind: 'finished', outcome: '1' });
    let reads = 0;
    const counting = recordingStore({
      ...first.store,
      readDefinition: (hash) => {
        reads += 1;
        return first.store.readDefinition(hash);
      },
    });
    const fresh = testRuntime({ store: counting });
    expect(fresh.runtime.inspect('test').state).toMatchObject({ kind: 'waiting' });
    expect(fresh.runtime.inspect('test/1').state).toMatchObject({ kind: 'waiting', until: 1000n });
    expect(reads).toBe(1);
  });
});
