/**
 * What a runtime refuses as it reads an instance back from its store (§5), before anything of it
 * resumes: a snapshot of a format version it doesn't know or of a shape no snapshot has, one naming
 * a Definition the store lacks or an object it doesn't hold, one whose execution's frame doesn't fit
 * its Definition, and an instance the store lacks.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { FormatError } from '../../definition/formats/format.ts';
import { Refusal } from '../refusal.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { type PersistedObject, type Snapshot, snapshotFormat } from './format.ts';

type PersistedExecution = Extract<PersistedObject, { readonly kind: 'execution' }>;

/** A program whose spawned instance `p/1` commits waiting on a timer. */
const waitingProgram = compiledEncoded(
  lines(
    "import * as runtime from 'runtime'",
    "import * as time from 'time'",
    'ista async fn child() -> Int:',
    '  await time.delay(10ms)',
    '  1',
    'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
    'ista async fn _main() -> Int:',
    '  drop spawn child()',
    '  0',
  ),
);

/**
 * A runtime fresh on a store holding `p/1` committed waiting, its snapshot as `changed` makes it;
 * the runtime reads `p/1` back as it next touches it.
 */
async function readingBack(changed: (snapshot: Snapshot) => string) {
  const first = testRuntime();
  await startToEnd(first, waitingProgram, { instance: 'p' });
  const text = first.store.readSnapshot('p/1') ?? '';
  first.store.writeSnapshot('p/1', changed(snapshotFormat.read(text)));
  return testRuntime({ store: first.store, clock: first.clock });
}

const written = (snapshot: Snapshot) => snapshotFormat.write(snapshot);

const versionAtEnd = /"version":\d+\}$/u;
const version99Refused = /version 99 is not supported/u;

describe('reading an instance back', () => {
  it('resumes a snapshot as it was written', async () => {
    const test = await readingBack(written);
    test.clock.set(10n);
    expect((await test.runtime.wake('p/1')).state).toMatchObject({ kind: 'finished' });
  });

  it('refuses a snapshot of a format version it does not know, saying so', async () => {
    const test = await readingBack((snapshot) =>
      written(snapshot).replace(versionAtEnd, '"version":99}'),
    );
    await expect(test.runtime.wake('p/1')).rejects.toThrow(FormatError);
    await expect(test.runtime.wake('p/1')).rejects.toThrow(version99Refused);
  });

  it('refuses a snapshot of a shape no snapshot has', async () => {
    const test = await readingBack((snapshot) =>
      written(snapshot).replace('"serial":', '"unknown":0,"serial":'),
    );
    await expect(test.runtime.wake('p/1')).rejects.toThrow(FormatError);
  });

  it('refuses a snapshot whose Definition the store lacks', async () => {
    const test = await readingBack((snapshot) =>
      written({ ...snapshot, definition: '0'.repeat(snapshot.definition.length) }),
    );
    await expect(test.runtime.wake('p/1')).rejects.toThrow(
      expect.objectContaining({ reason: 'unknownDefinition' }),
    );
  });

  it('refuses a snapshot naming an object it does not hold', async () => {
    const test = await readingBack((snapshot) =>
      written({ ...snapshot, live: [...snapshot.live, snapshot.serial + 1] }),
    );
    await expect(test.runtime.wake('p/1')).rejects.toThrow(
      expect.objectContaining({ reason: 'snapshotMismatch' }),
    );
  });

  it.each<[string, (execution: PersistedExecution) => PersistedExecution]>([
    ['a frame standing where no call waits', (execution) => ({ ...execution, pc: 0 })],
    ['a pc outside its function', (execution) => ({ ...execution, pc: 10_000 })],
    [
      'a register outside its frame',
      (execution) => ({ ...execution, registers: [...execution.registers, null] }),
    ],
    ['a frame of a function that is not code', (execution) => ({ ...execution, function: 10_000 })],
  ])('refuses a snapshot with %s, before resuming', async (_case, change) => {
    const test = await readingBack((snapshot) =>
      written({
        ...snapshot,
        objects: snapshot.objects.map((object) =>
          object.kind === 'execution' ? change(object) : object,
        ),
      }),
    );
    test.clock.set(10n);
    const commits = test.store.commits.length;
    await expect(test.runtime.wake('p/1')).rejects.toThrow(
      expect.objectContaining({ reason: 'snapshotMismatch' }),
    );
    expect(test.store.commits).toHaveLength(commits);
  });

  it('refuses an instance the store lacks', async () => {
    const test = await readingBack(written);
    await expect(test.runtime.wake('nobody')).rejects.toThrow(Refusal);
  });
});
