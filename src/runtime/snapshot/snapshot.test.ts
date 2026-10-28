/**
 * The snapshot format: a realistic snapshot (§12.3 stopped at its await) and random heaps
 * survive a round trip with a key-order-independent hash, and a snapshot whose ids dangle or
 * don't ascend is refused. A value as deep as an instance may persist round-trips; a body deeper
 * than any valid one is refused both ways, before the codecs recurse.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  broadcastAwaitPc,
  broadcastDefinition,
  broadcastFunctions,
  broadcastTypes,
} from '../../../test/definitions/broadcast.ts';
import { exactJson, looseText } from '../../definition/codec.test-kit.ts';
import { decodeJson } from '../../definition/codec.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { type EditableText, editedText, refusalOf } from '../../definition/format.test-kit.ts';
import { FormatError } from '../../definition/format.ts';
import { nested, valueArbitrary } from '../../definition/values.test-kit.ts';
import { maximumDepth, type Value } from '../../definition/values.ts';
import { seedBytes, seedTextOf } from '../random-seed.ts';
import { testSeed } from '../runtime.test-kit.ts';
import type { HeapObject } from './objects.ts';
import { type Snapshot, snapshotFormat } from './snapshot.ts';

const { revertible, duration } = broadcastTypes;

/** `announce("hello", ["ann", "bob"], 1m)` waiting on its delay, both copies still held. */
const broadcastWaiting: Snapshot = {
  definition: definitionFormat.write(broadcastDefinition).hash,
  instance: 'broadcast-1',
  status: { kind: 'active' },
  crashEveryAwait: false,
  terminatesOnPanic: false,
  spawned: 0,
  random: { seed: seedTextOf(testSeed), draws: 3 },
  pinned: [],
  ready: [],
  objects: [
    {
      id: 0,
      kind: 'execution',
      disposing: false,
      frames: [
        {
          function: broadcastFunctions.announce,
          pc: broadcastAwaitPc,
          registers: [
            [0, 'hello'],
            [1, { kind: 'array', elements: ['ann', 'bob'] }],
            [2, { kind: 'struct', type: duration, fields: [60_000n] }],
            [13, { kind: 'handle', object: 3 }],
            [
              14,
              {
                kind: 'array',
                elements: [
                  { kind: 'handle', object: 1 },
                  { kind: 'handle', object: 2 },
                ],
              },
            ],
          ],
        },
      ],
    },
    { id: 1, kind: 'resource', type: revertible, payload: { queue: 'ann', message: 'm-1' } },
    { id: 2, kind: 'resource', type: revertible, payload: { queue: 'bob', message: 'm-2' } },
    { id: 3, kind: 'future', state: { kind: 'timer', at: 1_700_000_060_000n } },
  ],
};

/** Heap objects with ids `ids`, whose handles and references point only among those ids. */
function objectsArbitrary(ids: readonly number[]): fc.Arbitrary<HeapObject[]> {
  const value = valueArbitrary({ typed: true, handles: ids });
  const id = fc.constantFrom(...ids);
  const reference = fc.record({
    kind: fc.constant('reference' as const),
    cell: id,
    path: fc.array(fc.nat({ max: 5 }), { maxLength: 3 }),
  });
  const frame = fc.record({
    function: fc.nat({ max: 9 }),
    pc: fc.nat({ max: 30 }),
    registers: fc.array(fc.tuple(fc.nat({ max: 20 }), fc.oneof(value, reference)), {
      maxLength: 4,
    }),
  });
  const futureState = fc.oneof(
    fc.record({ kind: fc.constant('resolved' as const), value }),
    fc.constant({ kind: 'call' as const }),
    fc.record({
      kind: fc.constant('first' as const),
      futures: fc.array(id, { minLength: 1, maxLength: 3 }),
    }),
    fc.record({
      kind: fc.constant('slot' as const),
      slot: id,
      operation: fc.constantFrom('put' as const, 'take' as const, 'read' as const),
      value,
    }),
    fc.record({ kind: fc.constant('timer' as const), at: fc.bigInt({ min: 0n, max: 2n ** 60n }) }),
    fc.record({ kind: fc.constant('host' as const), token: fc.string() }),
    fc.record({ kind: fc.constant('disposed' as const), weakRef: id }),
  );
  const objectFor = (objectId: number): fc.Arbitrary<HeapObject> =>
    fc.oneof(
      fc
        .record({ type: fc.nat({ max: 9 }), value })
        .map((parts) => ({ id: objectId, kind: 'cell' as const, ...parts })),
      fc
        .record({ value, waiting: fc.array(id, { maxLength: 3 }) })
        .map((parts) => ({ id: objectId, kind: 'slot' as const, ...parts })),
      futureState.map((state) => ({ id: objectId, kind: 'future' as const, state })),
      id.map((target) => ({ id: objectId, kind: 'weakRef' as const, target })),
      value.map((callback) => ({ id: objectId, kind: 'guard' as const, callback })),
      fc
        .record({ type: fc.nat({ max: 9 }), payload: exactJson })
        .map((parts) => ({ id: objectId, kind: 'resource' as const, ...parts })),
      fc
        .record({
          target: fc.nat({ max: 9 }),
          replacement: value,
          calls: fc.array(value, { maxLength: 2 }),
        })
        .map((parts) => ({ id: objectId, kind: 'mock' as const, ...parts })),
      fc
        .record(
          {
            resolves: id,
            frames: fc.array(frame, { minLength: 1, maxLength: 3 }),
            disposing: fc.boolean(),
          },
          { requiredKeys: ['frames', 'disposing'] },
        )
        .map((parts) => ({ id: objectId, kind: 'execution' as const, ...parts })),
    );
  return fc.tuple(...ids.map(objectFor));
}

const snapshotArbitrary: fc.Arbitrary<Snapshot> = fc
  .uniqueArray(fc.nat({ max: 1000 }), { minLength: 1, maxLength: 6 })
  .map((ids) => ids.toSorted((left, right) => left - right))
  .chain((ids) => objectsArbitrary(ids))
  .chain((objects) => {
    const executions = objects.filter((object) => object.kind === 'execution');
    return fc.record({
      definition: fc.constant('0'.repeat(64)),
      instance: fc.string(),
      status: fc.oneof(
        fc.constant({ kind: 'active' as const }),
        fc.record({
          kind: fc.constant('panicked' as const),
          message: fc.string(),
          trace: fc.string(),
          segmentStartedAt: fc.bigInt({ min: 0n, max: 2n ** 60n }),
        }),
        fc.record({ kind: fc.constant('finished' as const), outcome: valueArbitrary() }),
        fc.record({
          kind: fc.constant('terminated' as const),
          message: fc.string(),
          trace: fc.string(),
        }),
        fc.record({
          kind: fc.constant('unstarted' as const),
          call: fc.record({
            function: fc.nat({ max: 9 }),
            captures: fc.array(valueArbitrary({ typed: true }), { maxLength: 2 }),
            arguments: fc.array(valueArbitrary({ typed: true }), { maxLength: 2 }),
          }),
        }),
      ),
      crashEveryAwait: fc.boolean(),
      terminatesOnPanic: fc.boolean(),
      spawned: fc.nat({ max: 50 }),
      random: fc.record({
        seed: fc.uint8Array({ minLength: seedBytes, maxLength: seedBytes }).map(seedTextOf),
        draws: fc.nat(),
      }),
      pinned: fc.constant([]),
      objects: fc.constant(objects),
      ready: fc.subarray(executions.map((execution) => execution.id)),
    });
  });

/** The broadcast snapshot's JSON, changed by `edit`, as text. */
function editedSnapshot(edit: (json: EditableText) => void): string {
  return editedText(snapshotFormat, broadcastWaiting, edit);
}

function objectsOf(json: EditableText): Record<string, unknown>[] {
  return json.body.objects as Record<string, unknown>[];
}

describe('snapshot format', () => {
  it('keeps an instance stopped at its await', () => {
    const written = snapshotFormat.write(broadcastWaiting);
    expect(snapshotFormat.read(written.text)).toEqual(broadcastWaiting);
  });

  it('round-trips any heap, with a hash independent of key order', () => {
    fc.assert(
      fc.property(snapshotArbitrary, (snapshot) => {
        const written = snapshotFormat.write(snapshot);
        expect(snapshotFormat.read(written.text)).toEqual(snapshot);
        const loose = looseText(decodeJson(written.text));
        expect(snapshotFormat.write(snapshotFormat.read(loose))).toEqual(written);
      }),
    );
  });

  it.each<[string, (json: EditableText) => void, string, string]>([
    [
      'a handle to a missing object',
      (json) => {
        objectsOf(json).push({
          id: 9,
          kind: 'cell',
          type: 0,
          value: { kind: 'handle', object: 42 },
        });
      },
      'No object 42',
      'objects[4]',
    ],
    [
      'ids that do not ascend',
      (json) => {
        const [first, second] = objectsOf(json);
        objectsOf(json).splice(0, 2, second ?? {}, first ?? {});
      },
      'Object ids must ascend',
      'objects[1]',
    ],
    [
      'a ready entry that is not an execution',
      (json) => {
        json.body.ready = [3];
      },
      '3 is not an execution',
      'ready[0]',
    ],
    [
      'an unknown version',
      (json) => {
        json.version = 2;
      },
      'istalang-snapshot version 2 is not supported',
      'this reader knows version 1',
    ],
  ])('refuses %s', (_case, edit, problem, where) => {
    const message = refusalOf(snapshotFormat, editedSnapshot(edit));
    expect(message).toContain(problem);
    expect(message).toContain(where);
  });
});

/** A snapshot whose one object is a cell holding `contents`. */
function holding(contents: Value): Snapshot {
  return {
    definition: broadcastWaiting.definition,
    instance: 'deep',
    status: { kind: 'active' },
    crashEveryAwait: false,
    terminatesOnPanic: false,
    spawned: 0,
    random: broadcastWaiting.random,
    pinned: [],
    objects: [{ kind: 'cell', id: 0, type: 0, value: contents }],
    ready: [],
  };
}

/** Maps of one entry, `depth` deep: the kind taking the most levels on disk per level of its own. */
function nestedMaps(depth: number): Value {
  let current: Value = 1n;
  for (let level = 0; level < depth; level += 1) {
    current = { kind: 'map', entries: [[1n, current]] };
  }
  return current;
}

describe('snapshot depth', () => {
  it('round-trips a value as deep as an instance may persist', () => {
    const snapshot = holding(nestedMaps(maximumDepth));
    expect(snapshotFormat.read(snapshotFormat.write(snapshot).text)).toEqual(snapshot);
  });

  it('refuses a body deeper than any valid one, written or read', () => {
    const tooDeep = nested(2 * maximumDepth, 1n);
    expect(() => snapshotFormat.write(holding(tooDeep))).toThrow(FormatError);
    const text = editedText(snapshotFormat, holding(1n), (json) => {
      objectsOf(json).splice(0, 1, { kind: 'cell', id: 0, type: 0, value: tooDeep });
    });
    expect(refusalOf(snapshotFormat, text)).toContain('nests deeper than');
  });
});
