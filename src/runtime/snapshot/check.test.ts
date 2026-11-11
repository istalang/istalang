/**
 * What a runtime refuses when it reads an instance back from its store (§5): texts of an unknown
 * format version, a snapshot naming a Definition the store lacks, and a snapshot that doesn't fit
 * its Definition, each found before anything resumes; and instances the store lacks or already has.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { FormatError } from '../../definition/formats/format.ts';
import type { Value } from '../../definition/values/values.ts';
import { Refusal } from '../refusal.ts';
import { recordingStore, runToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { ResolverTarget } from './objects.ts';
import { type Snapshot, snapshotFormat } from './snapshot.ts';

/** A program committed while it waits two executions deep. */
const waitingProgram = compiledText(
  [
    "import * as time from 'time'",
    'ista async fn inner() -> Int:',
    '  await time.delay(10ms)',
    '  1',
    'ista async fn main():',
    '  await inner()',
  ].join('\n'),
);

/**
 * A store holding one instance of `waitingProgram`, committed while it waits, and a runtime
 * restarted on it, which reads the instance back from the store when it next touches it.
 */
async function waitingInstance() {
  const test = testRuntime();
  const program = test.runtime.deploy(waitingProgram);
  await program.start('i');
  const text = test.store.readSnapshot('i') ?? '';
  const restarted = testRuntime({ store: test.store, clock: test.clock });
  return { ...restarted, program, snapshot: snapshotFormat.read(text) };
}

/** The stored instance `i` replaced by `change` of its snapshot. */
function storeChanged(
  test: Awaited<ReturnType<typeof waitingInstance>>,
  change: (s: Snapshot) => Snapshot,
) {
  test.store.writeSnapshot('i', snapshotFormat.write(change(test.snapshot)).text);
}

const versionAtEnd = /"version":1\}$/u;
const version99Refused = /version 99 is not supported/u;
const version7Refused = /version 7 is not supported/u;

const mismatch = expect.objectContaining({ reason: 'snapshotMismatch' });

const executionIds = (snapshot: Snapshot) =>
  snapshot.objects.flatMap((object) => (object.kind === 'execution' ? [object.id] : []));

/** `snapshot` finished with `outcome`, holding nothing. */
const finishedWith = (
  snapshot: Snapshot,
  outcome: { readonly outcome: Value; readonly encoded?: Value },
): Snapshot => ({
  ...snapshot,
  status: { kind: 'finished', ...outcome },
  objects: [],
  ready: [],
});

/** The entry of a frame `snapshot` holds: an async function's, which can't encode an outcome. */
const frameEntry = (snapshot: Snapshot) =>
  snapshot.objects.flatMap((object) =>
    object.kind === 'execution' ? object.frames.map((frame) => frame.function) : [],
  )[0] ?? 0;

/** `snapshot` with a ready run calling the entry of a frame it holds, with `call`'s parts. */
const withRun = (snapshot: Snapshot, call: { readonly arguments?: readonly Value[] }): Snapshot => {
  const id = 10_000;
  const run = {
    kind: 'run' as const,
    id,
    function: frameEntry(snapshot),
    captures: [],
    arguments: [...(call.arguments ?? [])],
  };
  return { ...snapshot, objects: [...snapshot.objects, run], ready: [...snapshot.ready, id] };
};

/** `snapshot` with a pending `Resolver.of` resolver `done`, and a `Resolver.at` one `at` of it. */
const withPosition = (snapshot: Snapshot, done: number, at: number): Snapshot => {
  const pending = (id: number, target: ResolverTarget) => ({
    kind: 'resolver' as const,
    id,
    state: { kind: 'pending' as const, target, on: [], onCancel: [] },
  });
  const resolvers = [
    pending(done, { kind: 'callback', callback: null }),
    pending(at, { kind: 'at', done, position: 0n }),
  ].toSorted((first, second) => first.id - second.id);
  return { ...snapshot, objects: [...snapshot.objects, ...resolvers] };
};

const withVersion = (text: string, version: number) =>
  text.replace(versionAtEnd, `"version":${version}}`);

describe('reading an instance back', () => {
  it('refuses a snapshot of a version this runtime does not know, saying so', async () => {
    const test = await waitingInstance();
    test.store.writeSnapshot('i', withVersion(test.store.readSnapshot('i') ?? '', 99));
    await expect(test.runtime.wake('i')).rejects.toThrow(FormatError);
    await expect(test.runtime.wake('i')).rejects.toThrow(version99Refused);
  });

  it('refuses a stored Definition of a version this runtime does not know', async () => {
    const test = await waitingInstance();
    test.store.writeDefinition(test.program.hash, withVersion(waitingProgram, 7));
    const fresh = testRuntime({ store: test.store, clock: test.clock });
    await expect(fresh.runtime.wake('i')).rejects.toThrow(version7Refused);
  });

  it('refuses a snapshot whose Definition the store lacks', async () => {
    const test = await waitingInstance();
    storeChanged(test, (snapshot) => ({ ...snapshot, definition: '0'.repeat(64) }));
    await expect(test.runtime.wake('i')).rejects.toThrow(
      expect.objectContaining({ reason: 'unknownDefinition' }),
    );
  });

  it.each<[string, (frame: Frame) => Frame]>([
    ['a frame standing where no execution stops', (frame) => ({ ...frame, pc: 0 })],
    ['a pc outside its function', (frame) => ({ ...frame, pc: 10_000 })],
    [
      'a register outside its frame',
      (frame) => ({ ...frame, registers: [...frame.registers, [10_000, 1n]] }),
    ],
    ['a frame of a function that is not code', (frame) => ({ ...frame, function: 10_000 })],
  ])('refuses a snapshot with %s, before resuming', async (_case, change) => {
    const test = await waitingInstance();
    storeChanged(test, (snapshot) => ({
      ...snapshot,
      objects: snapshot.objects.map((object) =>
        object.kind === 'execution' ? { ...object, frames: object.frames.map(change) } : object,
      ),
    }));
    test.clock.set(10n);
    await expect(test.runtime.wake('i')).rejects.toThrow(mismatch);
    expect(test.store.commits).toHaveLength(2);
  });

  it.each<[string, Value]>([
    [
      'a closure naming a function the Definition lacks',
      { kind: 'closure', function: 9999, captures: [] },
    ],
    ['a struct of a type the Definition lacks', { kind: 'struct', type: 9999, fields: [] }],
    [
      'a struct whose fields disagree with its type',
      { kind: 'struct', type: 0, fields: [1n, 2n, 3n, 4n] },
    ],
  ])('refuses a snapshot holding %s', async (_case, value) => {
    const test = await waitingInstance();
    storeChanged(test, (snapshot) => ({
      ...snapshot,
      objects: snapshot.objects.map((object) =>
        object.kind === 'execution'
          ? {
              ...object,
              frames: object.frames.map((frame) => ({
                ...frame,
                registers: [...frame.registers, [0, value]],
              })),
            }
          : object,
      ),
    }));
    await expect(test.runtime.wake('i')).rejects.toThrow(mismatch);
  });

  it('refuses a resource of a type that is not extern', async () => {
    const test = await waitingInstance();
    storeChanged(test, (snapshot) => ({
      ...snapshot,
      objects: [...snapshot.objects, { kind: 'resource', id: 1000, type: 0, payload: null }],
    }));
    await expect(test.runtime.wake('i')).rejects.toThrow(mismatch);
  });

  it('refuses a ready execution that is not at an await', async () => {
    const test = await waitingInstance();
    storeChanged(test, (snapshot) => ({
      ...snapshot,
      ready: snapshot.objects.flatMap((object) => (object.kind === 'execution' ? [object.id] : [])),
      objects: snapshot.objects.map((object) =>
        object.kind === 'execution'
          ? { ...object, frames: object.frames.map((frame) => ({ ...frame, pc: 0 })) }
          : object,
      ),
    }));
    await expect(test.runtime.wake('i')).rejects.toThrow(mismatch);
  });

  it.each<[string, (snapshot: Snapshot) => Snapshot]>([
    [
      'an execution ready twice',
      (snapshot) => ({
        ...snapshot,
        ready: [...executionIds(snapshot), ...executionIds(snapshot)],
      }),
    ],
    [
      'a ready execution waiting on an unresolved future',
      (snapshot) => ({ ...snapshot, ready: executionIds(snapshot) }),
    ],
    [
      'an await on something that is not a future',
      (snapshot) => ({
        ...snapshot,
        objects: snapshot.objects.map((object) =>
          object.kind === 'execution'
            ? {
                ...object,
                frames: object.frames.map((frame) => ({
                  ...frame,
                  registers: frame.registers.map(([register]) => [register, 1n] as [number, Value]),
                })),
              }
            : object,
        ),
      }),
    ],
    [
      'an execution waiting on a resolved future but not ready',
      (snapshot) => ({
        ...snapshot,
        objects: snapshot.objects.map((object) =>
          object.kind === 'future'
            ? { ...object, state: { kind: 'resolved', value: null } }
            : object,
        ),
      }),
    ],
    [
      'a run its function takes fewer arguments than',
      (snapshot) => withRun(snapshot, { arguments: [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n] }),
    ],
    ['a run that is not ready', (snapshot) => ({ ...withRun(snapshot, {}), ready: [] })],
    [
      'a Resolver.at resolver deciding one made after it',
      (snapshot) => withPosition(snapshot, 10_001, 10_000),
    ],
    ['an outcome encoder that is no function', (snapshot) => ({ ...snapshot, encoder: 10_000 })],
    [
      'an outcome of a type the Definition lacks',
      (snapshot) => finishedWith(snapshot, { outcome: { kind: 'struct', type: 9999, fields: [] } }),
    ],
    [
      "an outcome's JSON that is no Json value",
      (snapshot) => finishedWith(snapshot, { outcome: 1n, encoded: 42n }),
    ],
    [
      "an outcome encoder that can't encode",
      (snapshot) => ({ ...snapshot, encoder: frameEntry(snapshot) }),
    ],
  ])('refuses a snapshot with %s', async (_case, change) => {
    const test = await waitingInstance();
    storeChanged(test, change);
    await expect(test.runtime.wake('i')).rejects.toThrow(mismatch);
  });

  it('accepts a Resolver.at resolver deciding one made before it', async () => {
    const test = await waitingInstance();
    storeChanged(test, (snapshot) => withPosition(snapshot, 10_000, 10_001));
    await expect(test.runtime.wake('i')).resolves.toBeDefined();
  });

  it("refuses a snapshot whose stored Definition doesn't hash to the one it names", async () => {
    const test = await waitingInstance();
    test.store.writeDefinition(test.program.hash, compiledText('ista async fn main(): 2'));
    const fresh = testRuntime({ store: test.store, clock: test.clock });
    await expect(fresh.runtime.wake('i')).rejects.toThrow(mismatch);
  });

  it('reads the store on a wake without writing the Definition back', async () => {
    const test = await waitingInstance();
    const store = recordingStore(test.store);
    const fresh = testRuntime({ store, clock: test.clock });
    test.clock.set(10n);
    expect(await runToEnd(fresh, 'i', await fresh.runtime.wake('i'))).toEqual({
      kind: 'finished',
      outcome: '1',
    });
    expect(store.definitions).toEqual([]);
  });

  it('refuses to wake an instance the store lacks, and to start one it already has', async () => {
    const test = await waitingInstance();
    await expect(test.runtime.wake('nobody')).rejects.toThrow(Refusal);
    await expect(test.program.start('i')).rejects.toThrow(
      expect.objectContaining({ reason: 'instanceExists' }),
    );
  });
});

type Frame = Extract<Snapshot['objects'][number], { kind: 'execution' }>['frames'][number];
