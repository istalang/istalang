/**
 * What a runtime refuses when it reads an instance back from its store (§5): texts of an unknown
 * format version, a snapshot naming a Definition the store lacks, and a snapshot that doesn't fit
 * its Definition, each found before anything resumes; and instances the store lacks or already has.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { FormatError } from '../../definition/format.ts';
import type { Value } from '../../definition/values.ts';
import { Refusal } from '../refusal.ts';
import { runToEnd, testRuntime } from '../runtime.test-kit.ts';
import { type Snapshot, snapshotFormat } from './snapshot.ts';

/** A program committed while it waits two executions deep. */
const waitingProgram = compiledText(
  [
    "import * as time from 'time'",
    'async fn inner() -> Future<int>:',
    '  await time.delay(10ms)',
    '  1',
    'async fn main():',
    '  await inner()',
  ].join('\n'),
);

/** A runtime holding one instance of `waitingProgram`, committed while it waits. */
function waitingInstance() {
  const test = testRuntime();
  const program = test.runtime.deploy(waitingProgram);
  program.start('i');
  const text = test.store.readSnapshot('i') ?? '';
  return { ...test, program, snapshot: snapshotFormat.read(text) };
}

/** The stored instance `i` replaced by `change` of its snapshot. */
function storeChanged(test: ReturnType<typeof waitingInstance>, change: (s: Snapshot) => Snapshot) {
  test.store.writeSnapshot('i', snapshotFormat.write(change(test.snapshot)).text);
}

const versionAtEnd = /"version":1\}$/u;
const version99Refused = /version 99 is not supported/u;
const version7Refused = /version 7 is not supported/u;

const mismatch = expect.objectContaining({ reason: 'snapshotMismatch' });

const executionIds = (snapshot: Snapshot) =>
  snapshot.objects.flatMap((object) => (object.kind === 'execution' ? [object.id] : []));

const withVersion = (text: string, version: number) =>
  text.replace(versionAtEnd, `"version":${version}}`);

describe('reading an instance back', () => {
  it('refuses a snapshot of a version this runtime does not know, saying so', () => {
    const test = waitingInstance();
    test.store.writeSnapshot('i', withVersion(test.store.readSnapshot('i') ?? '', 99));
    expect(() => test.runtime.wake('i')).toThrow(FormatError);
    expect(() => test.runtime.wake('i')).toThrow(version99Refused);
  });

  it('refuses a stored Definition of a version this runtime does not know', () => {
    const test = waitingInstance();
    test.store.writeDefinition(test.program.hash, withVersion(waitingProgram, 7));
    const fresh = testRuntime({ store: test.store, clock: test.clock });
    expect(() => fresh.runtime.wake('i')).toThrow(version7Refused);
  });

  it('refuses a snapshot whose Definition the store lacks', () => {
    const test = waitingInstance();
    storeChanged(test, (snapshot) => ({ ...snapshot, definition: '0'.repeat(64) }));
    expect(() => test.runtime.wake('i')).toThrow(
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
  ])('refuses a snapshot with %s, before resuming', (_case, change) => {
    const test = waitingInstance();
    storeChanged(test, (snapshot) => ({
      ...snapshot,
      objects: snapshot.objects.map((object) =>
        object.kind === 'execution' ? { ...object, frames: object.frames.map(change) } : object,
      ),
    }));
    test.clock.set(10n);
    expect(() => test.runtime.wake('i')).toThrow(mismatch);
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
  ])('refuses a snapshot holding %s', (_case, value) => {
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
    expect(() => test.runtime.wake('i')).toThrow(mismatch);
  });

  it('refuses a resource of a type that is not extern', () => {
    const test = waitingInstance();
    storeChanged(test, (snapshot) => ({
      ...snapshot,
      objects: [...snapshot.objects, { kind: 'resource', id: 1000, type: 0, payload: null }],
    }));
    expect(() => test.runtime.wake('i')).toThrow(mismatch);
  });

  it('refuses a ready execution that is not at an await', () => {
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
    expect(() => test.runtime.wake('i')).toThrow(mismatch);
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
  ])('refuses a snapshot with %s', (_case, change) => {
    const test = waitingInstance();
    storeChanged(test, change);
    expect(() => test.runtime.wake('i')).toThrow(mismatch);
  });

  it("refuses a snapshot whose stored Definition doesn't hash to the one it names", () => {
    const test = waitingInstance();
    test.store.writeDefinition(test.program.hash, compiledText('async fn main(): 2'));
    const fresh = testRuntime({ store: test.store, clock: test.clock });
    expect(() => fresh.runtime.wake('i')).toThrow(mismatch);
  });

  it('reads the store on a wake without writing the Definition back', () => {
    const test = waitingInstance();
    const written: string[] = [];
    const store = {
      ...test.store,
      writeDefinition: (hash: string) => {
        written.push(hash);
      },
    };
    const fresh = testRuntime({ store, clock: test.clock });
    test.clock.set(10n);
    expect(runToEnd(fresh, 'i', fresh.runtime.wake('i'))).toEqual({
      kind: 'finished',
      outcome: 1n,
    });
    expect(written).toEqual([]);
  });

  it('refuses to wake an instance the store lacks, and to start one it already has', () => {
    const test = waitingInstance();
    expect(() => test.runtime.wake('nobody')).toThrow(Refusal);
    expect(() => test.program.start('i')).toThrow(
      expect.objectContaining({ reason: 'instanceExists' }),
    );
  });
});

type Frame = Extract<Snapshot['objects'][number], { kind: 'execution' }>['frames'][number];
