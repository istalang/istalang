/**
 * Maps as values: whatever keys are set, in whatever order, a lookup finds exactly what `==` says
 * is the same key, a later set of an equal key replaces its value in place, and two maps are
 * equal when they hold equal values for equal keys, in any order. Building a map key by key
 * carries its hash table over, which must find what a table built from scratch finds.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exactJson } from './codec.test-kit.ts';
import {
  entryPosition,
  entryValue,
  type MapValue,
  mapOf,
  valuesEqual,
  withEntry,
  withoutEntry,
} from './equality.ts';
import { nested, valueArbitrary } from './values.test-kit.ts';
import type { Value } from './values.ts';

const keys = valueArbitrary({ typed: true });
const entries = fc.array(fc.tuple(keys, valueArbitrary({ typed: true })), { maxLength: 12 });
const externs = fc
  .record({ type: fc.nat({ max: 3 }), payload: exactJson })
  .map((parts): Value => ({ kind: 'extern', ...parts }));

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
        const set = withEntry(map, key, value);
        const added = scanned(map, key) === undefined ? 1 : 0;
        const found = scanned(set, key);
        expect(found === undefined ? undefined : set.entries[found]?.[1]).toBe(
          found === undefined ? undefined : value,
        );
        expect(set.entries.length).toBe(map.entries.length + added);
        expect(scanned(withoutEntry(set, key), key)).toBeUndefined();
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

  it('compare and find keys of any depth', () => {
    const deep = nested(100_000, 1n);
    const map = mapOf([[deep, 'found']]);
    expect(valuesEqual(deep, nested(100_000, 1n))).toBe(true);
    expect(valuesEqual(deep, nested(100_000, 2n))).toBe(false);
    expect(entryValue(map, nested(100_000, 1n))).toBe('found');
    expect(entryValue(map, nested(99_999, 1n))).toBeUndefined();
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
      fc.property(externs, (value) => {
        const copy = structuredClone(value);
        expect(valuesEqual(value, copy)).toBe(true);
        expect(entryValue(mapOf([[value, 1n]]), copy)).toBe(1n);
      }),
    );
  });

  it('differ when their payload JSON does', () => {
    const queue = (name: string): Value => ({ kind: 'extern', type: 0, payload: { name } });
    expect(valuesEqual(queue('a'), queue('b'))).toBe(false);
  });
});
