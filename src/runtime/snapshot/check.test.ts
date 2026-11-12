/**
 * What a runtime refuses when it reads an instance back from its store (§5): texts of an unknown
 * format version, a snapshot naming a Definition the store lacks, and a snapshot that doesn't fit
 * its Definition, each found before anything resumes; and instances the store lacks or already has.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { FormatError } from '../../definition/formats/format.ts';
import type { Value } from '../../definition/values/values.ts';
import { Refusal } from '../refusal.ts';
import { recordingStore, runToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { ChainRoot, ResolverTarget } from './objects.ts';
import { type InstanceCall, type Snapshot, snapshotFormat } from './snapshot.ts';

/** A program committed while it waits two executions deep. */
const waitingProgram = compiledText(
  [
    "import * as time from 'time'\nimport * as runtime from 'runtime'",
    'ista async fn inner() -> Int:',
    '  await time.delay(10ms)',
    '  1',
    'live async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():',
    '  await inner()',
  ].join('\n'),
);

/**
 * A store holding one instance of `waitingProgram`, committed while it waits, and a runtime
 * restarted on it, which reads the instance back from the store when it next touches it.
 */
function waitingInstance() {
  const test = testRuntime();
  const program = test.runtime.deploy(waitingProgram);
  test.startInstance(waitingProgram, 'i');
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

/**
 * A function value of a plain function `waitingProgram` holds taking `arity` arguments, none
 * left out or by reference: one a callback called with that many may be.
 */
const plainFunctionTaking = (arity: number): Value => ({
  kind: 'closure',
  function: definitionFormat
    .read(waitingProgram)
    .functions.findIndex(
      (entry) =>
        entry.kind === 'code' &&
        entry.mode === 'simple' &&
        entry.captures === 0 &&
        entry.parameters.length === arity &&
        entry.parameters.every(({ reference, hasDefault }) => !(reference || hasDefault)),
    ),
  captures: [],
});

/** What a resolver calls back with its value, and what it calls once cancelled. */
const valueCallback = plainFunctionTaking(1);
const cancelCallback = plainFunctionTaking(0);

/** A pending resolver `id` deciding `target`, with `onCancel` callbacks. */
const pendingResolver = (id: number, target: ResolverTarget, onCancel: readonly Value[] = []) => ({
  kind: 'resolver' as const,
  id,
  state: { kind: 'pending' as const, target, on: [], onCancel: [...onCancel] },
});

/**
 * `snapshot` with a pending `Resolver.of` resolver `done`, and a `Resolver.at` one `at` of it, which
 * names `root` as its chain's.
 */
const withPosition = (
  snapshot: Snapshot,
  done: number,
  at: number,
  root: ChainRoot = 'callback',
): Snapshot => {
  const resolvers = [
    pendingResolver(done, { kind: 'callback', callback: valueCallback }),
    pendingResolver(at, { kind: 'at', done, position: 0n, root }),
  ].toSorted((first, second) => first.id - second.id);
  return { ...snapshot, objects: [...snapshot.objects, ...resolvers] };
};

/** `snapshot` with a pending resolver calling back `callback`, cancelled calling `onCancel`. */
const withCallback = (snapshot: Snapshot, callback: Value, onCancel: readonly Value[] = []) => ({
  ...snapshot,
  objects: [...snapshot.objects, pendingResolver(10_000, { kind: 'callback', callback }, onCancel)],
});

/** `snapshot` panicked in the segment a host's call `call` started, which a retry runs again. */
const panickedReplaying = (snapshot: Snapshot, call: InstanceCall): Snapshot => ({
  ...snapshot,
  status: {
    kind: 'panicked',
    message: 'no',
    trace: '',
    segmentStartedAt: 0n,
    replay: { kind: 'invocation', invocation: { call, token: 't' } },
  },
});

const withVersion = (text: string, version: number) =>
  text.replace(versionAtEnd, `"version":${version}}`);

describe('reading an instance back', () => {
  it('refuses a snapshot of a version this runtime does not know, saying so', async () => {
    const test = waitingInstance();
    test.store.writeSnapshot('i', withVersion(test.store.readSnapshot('i') ?? '', 99));
    await expect(test.runtime.wake('i')).rejects.toThrow(FormatError);
    await expect(test.runtime.wake('i')).rejects.toThrow(version99Refused);
  });

  it('refuses a stored Definition of a version this runtime does not know', async () => {
    const test = waitingInstance();
    test.store.writeDefinition(test.program.hash, withVersion(waitingProgram, 7));
    const fresh = testRuntime({ store: test.store, clock: test.clock });
    await expect(fresh.runtime.wake('i')).rejects.toThrow(version7Refused);
  });

  it('refuses a snapshot whose Definition the store lacks', async () => {
    const test = waitingInstance();
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
    const test = waitingInstance();
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
    const test = waitingInstance();
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
    const test = waitingInstance();
    storeChanged(test, (snapshot) => ({
      ...snapshot,
      objects: [...snapshot.objects, { kind: 'resource', id: 1000, type: 0, payload: null }],
    }));
    await expect(test.runtime.wake('i')).rejects.toThrow(mismatch);
  });

  it('refuses a ready execution that is not at an await', async () => {
    const test = waitingInstance();
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
    ['a run calling back an async function', (snapshot) => withRun(snapshot, {})],
    ['a resolver calling back what is no function', (snapshot) => withCallback(snapshot, 1n)],
    [
      'a resolver calling back an async function',
      (snapshot) =>
        withCallback(snapshot, { kind: 'closure', function: frameEntry(snapshot), captures: [] }),
    ],
    [
      'a resolver cancelled calling what is no function',
      (snapshot) => withCallback(snapshot, valueCallback, [null]),
    ],
    [
      'a resolver calling back a function taking no value',
      (snapshot) => withCallback(snapshot, cancelCallback),
    ],
    [
      'a resolver cancelled calling a function that takes a value',
      (snapshot) => withCallback(snapshot, valueCallback, [valueCallback]),
    ],
    [
      "a host's call to replay into a function the Definition lacks",
      (snapshot) => panickedReplaying(snapshot, { function: 9999, captures: [], arguments: [] }),
    ],
    [
      'a Resolver.at resolver deciding one made after it',
      (snapshot) => withPosition(snapshot, 10_001, 10_000),
    ],
    [
      "a Resolver.at resolver naming a root its chain doesn't come down to",
      (snapshot) => withPosition(snapshot, 10_000, 10_001, 'case'),
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
    const test = waitingInstance();
    storeChanged(test, change);
    await expect(test.runtime.wake('i')).rejects.toThrow(mismatch);
  });

  it('accepts a resolver calling back a plain function, cancelled calling one', async () => {
    const test = waitingInstance();
    storeChanged(test, (snapshot) => withCallback(snapshot, valueCallback, [cancelCallback]));
    await expect(test.runtime.wake('i')).resolves.toBeDefined();
  });

  it('accepts a Resolver.at resolver deciding one made before it', async () => {
    const test = waitingInstance();
    storeChanged(test, (snapshot) => withPosition(snapshot, 10_000, 10_001));
    await expect(test.runtime.wake('i')).resolves.toBeDefined();
  });

  it("refuses a snapshot whose stored Definition doesn't hash to the one it names", async () => {
    const test = waitingInstance();
    test.store.writeDefinition(
      test.program.hash,
      compiledText(
        "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 2",
      ),
    );
    const fresh = testRuntime({ store: test.store, clock: test.clock });
    await expect(fresh.runtime.wake('i')).rejects.toThrow(mismatch);
  });

  it('reads the store on a wake without writing the Definition back', async () => {
    const test = waitingInstance();
    const store = recordingStore(test.store);
    const fresh = testRuntime({ store, clock: test.clock });
    test.clock.set(10n);
    expect(await runToEnd(fresh, 'i', await fresh.runtime.wake('i'))).toEqual({
      kind: 'finished',
      outcome: 1n,
    });
    expect(store.definitions).toEqual([]);
  });

  it('refuses to wake an instance the store lacks', async () => {
    const test = waitingInstance();
    await expect(test.runtime.wake('nobody')).rejects.toThrow(Refusal);
  });
});

type Frame = Extract<Snapshot['objects'][number], { kind: 'execution' }>['frames'][number];
