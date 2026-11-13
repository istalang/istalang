/**
 * Maps as values: whatever keys are set, in whatever order, a lookup finds exactly what `==` says
 * is the same key, a later set of an equal key replaces its value in place, and two maps are
 * equal when they hold equal values for equal keys, in any order. Building a map key by key keeps
 * its hash table as it goes, which must find what a table built from scratch finds.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reverseKeys } from '../formats/codec.test-kit.ts';
import { decodeJson, encodeJson } from '../formats/codec.ts';
import {
  deleteEntryInPlace,
  entryPosition,
  entryValue,
  type MapValue,
  mapOf,
  setEntryInPlace,
  valuesEqual,
} from './equality.ts';
import { nested, valueArbitrary } from './values.test-kit.ts';
import type { Value } from './values.ts';

const keys = valueArbitrary({ typed: true });
const entries = fc.array(fc.tuple(keys, valueArbitrary({ typed: true })), { maxLength: 12 });
/** JSON as a host value's payload holds it in memory: every integer a bigint (json-values.ts). */
const hostJson: fc.Arbitrary<unknown> = fc.letrec<{ json: unknown }>((tie) => ({
  json: fc.oneof(
    { depthSize: 'small', maxDepth: 4 },
    fc.constant(null),
    fc.boolean(),
    fc.string(),
    fc.bigInt({ min: -(2n ** 70n), max: 2n ** 70n }),
    fc.double({ min: -1e15, max: 1e15, noNaN: true }).filter((n) => !Number.isInteger(n)),
    fc.array(tie('json'), { maxLength: 4 }),
    fc.dictionary(fc.string(), tie('json'), { maxKeys: 4 }),
  ),
})).json;

const extern = (payload: unknown): Value => ({ kind: 'extern', type: 0, payload });

/** The position of `key` found by scanning with `==`, as a lookup must find it. */
function scanned(map: MapValue, key: Value): number | undefined {
  const position = map.entries.findIndex(([other]) => valuesEqual(other, key));
  return position < 0 ? undefined : position;
}

/** A copy of `map` that shares no derived table with it. */
function fresh(map: MapValue): MapValue {
  return { kind: 'map', entries: [...map.entries] };
}

describe('maps as values', () => {
  it('find exactly the key == finds, whether built key by key or from scratch', () => {
    fc.assert(
      fc.property(entries, keys, (pairs, probe) => {
        const built = mapOf(pairs);
        for (const key of [probe, ...pairs.map(([first]) => first)]) {
          expect(entryPosition(built, key)).toBe(scanned(built, key));
          expect(entryPosition(fresh(built), key)).toBe(scanned(built, key));
        }
      }),
    );
  });

  it('replace an equal key in place, and drop one that is deleted', () => {
    fc.assert(
      fc.property(entries, keys, valueArbitrary({ typed: true }), (pairs, key, value) => {
        const map = mapOf(pairs);
        const set = mapOf(pairs);
        setEntryInPlace(set, key, value);
        const added = scanned(map, key) === undefined ? 1 : 0;
        const found = scanned(set, key);
        expect(found === undefined ? undefined : set.entries[found]?.[1]).toBe(
          found === undefined ? undefined : value,
        );
        expect(set.entries.length).toBe(map.entries.length + added);
        expect(entryPosition(set, key)).toBe(found);
        deleteEntryInPlace(set, key);
        expect(scanned(set, key)).toBeUndefined();
        expect(entryPosition(set, key)).toBeUndefined();
      }),
    );
  });

  it('are equal by their entries, in any order', () => {
    const reorderings = entries.chain((pairs) =>
      fc.tuple(fc.constant(pairs), fc.shuffledSubarray(pairs, { minLength: pairs.length })),
    );
    fc.assert(
      fc.property(reorderings, ([pairs, shuffled]) => {
        const map = mapOf(pairs);
        const reordered = mapOf(shuffled);
        const holdsTheSame = (one: MapValue, other: MapValue) =>
          one.entries.every(([key, value]) => {
            const found = entryValue(other, key);
            return found !== undefined && valuesEqual(found, value);
          });
        expect(valuesEqual(map, reordered)).toBe(
          map.entries.length === reordered.entries.length &&
            holdsTheSame(map, reordered) &&
            holdsTheSame(reordered, map),
        );
      }),
    );
  });

  it('compare and find keys of any depth, maps keyed by maps included', () => {
    const deep = nested(100_000, 1n);
    const map = mapOf([[deep, 'found']]);
    expect(valuesEqual(deep, nested(100_000, 1n))).toBe(true);
    expect(valuesEqual(deep, nested(100_000, 2n))).toBe(false);
    expect(entryValue(map, nested(100_000, 1n))).toBe('found');
    expect(entryValue(map, nested(99_999, 1n))).toBeUndefined();
    const nestedMaps = (depth: number, leaf: Value): Value => {
      let current = leaf;
      for (let level = 0; level < depth; level += 1) {
        current = mapOf([[current, null]]);
      }
      return current;
    };
    expect(valuesEqual(nestedMaps(100_000, 1n), nestedMaps(100_000, 1n))).toBe(true);
    expect(valuesEqual(nestedMaps(100_000, 1n), nestedMaps(100_000, 2n))).toBe(false);
  });

  it('never find a NaN key, and treat -0 and 0 as one key', () => {
    const map = mapOf([
      [Number.NaN, 1n],
      [0, 2n],
      [-0, 3n],
    ]);
    expect(entryValue(map, Number.NaN)).toBeUndefined();
    expect(map.entries.length).toBe(3 - 1);
    expect(entryValue(map, -0)).toBe(3n);
  });
});

describe('extern values', () => {
  it('are equal by their payload JSON, as a snapshot round trip rebuilds it', () => {
    fc.assert(
      fc.property(hostJson, (payload) => {
        const live = extern(payload);
        for (const restored of [decodeJson(encodeJson(payload)), reverseKeys(payload)]) {
          expect(valuesEqual(live, extern(restored))).toBe(true);
          expect(entryValue(mapOf([[live, 1n]]), extern(restored))).toBe(1n);
        }
      }),
    );
  });

  it('differ when their payload JSON does', () => {
    expect(valuesEqual(extern({ queue: 'a' }), extern({ queue: 'b' }))).toBe(false);
    expect(valuesEqual(extern({ shard: 5n }), extern({ shard: 6 }))).toBe(false);
  });
});
