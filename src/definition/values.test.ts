/**
 * Persisted values: every kind survives the trip to text and back exactly, ints and floats stay
 * apart on disk, and handles are found at any depth.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeJson, encodeJson } from './codec.ts';
import { valueArbitrary } from './values.test-kit.ts';
import { handlesIn, type Value, value } from './values.ts';

function toText(contents: Value): string {
  return encodeJson(z.encode(value, contents));
}

function fromText(text: string): Value {
  return value.parse(decodeJson(text));
}

describe('persisted values', () => {
  it('round-trip exactly, for every kind', () => {
    fc.assert(
      fc.property(valueArbitrary({ typed: true, handles: [0, 7, 9] }), (contents) => {
        expect(fromText(toText(contents))).toEqual(contents);
      }),
    );
  });

  it('write ints as JSON integers and floats tagged', () => {
    expect(toText(2n)).toBe('2');
    expect(toText(2)).toBe('{"kind":"float","value":2}');
    expect(toText(10n ** 30n)).toBe('1000000000000000000000000000000');
    expect([Number.NaN, Number.POSITIVE_INFINITY, -0].map(toText)).toEqual([
      '{"kind":"float","value":"NaN"}',
      '{"kind":"float","value":"Infinity"}',
      '{"kind":"float","value":"-0"}',
    ]);
  });

  it('read a large whole float back as a float', () => {
    expect(fromText(toText(2 ** 60))).toBe(2 ** 60);
  });

  it('refuse shapes that are not values', () => {
    for (const text of ['{"kind":"float","value":"1"}', '{"kind":"set","elements":[]}', '1.5']) {
      expect(() => fromText(text), text).toThrow();
    }
  });

  it('expose every handle, however deep', () => {
    const nested: Value = {
      kind: 'struct',
      type: 0,
      fields: [
        { kind: 'handle', object: 3 },
        {
          kind: 'map',
          entries: [
            [
              { kind: 'handle', object: 5 },
              { kind: 'tuple', elements: [] },
            ],
          ],
        },
        {
          kind: 'closure',
          function: 1,
          captures: [{ kind: 'array', elements: [{ kind: 'handle', object: 8 }] }],
        },
      ],
    };
    expect(handlesIn(nested)).toEqual([3, 5, 8]);
    expect(handlesIn({ kind: 'extern', type: 0, payload: { kind: 'handle', object: 1 } })).toEqual(
      [],
    );
  });
});
