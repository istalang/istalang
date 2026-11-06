/**
 * Persisted values: every kind survives the trip to text and back exactly, ints and floats stay
 * apart on disk, and handles are found at any depth. A composite value's children are read and
 * rebuilt in one order. Walks over a value of any depth keep their own stack.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { subsetDefinition } from '../../../test/definitions/subset.ts';
import { decodeJson, encodeJson } from '../formats/codec.ts';
import { valueProblems } from '../validation/references.ts';
import { nested, valueArbitrary } from './values.test-kit.ts';
import {
  childValues,
  depthOf,
  handlesIn,
  isComposite,
  type Value,
  value,
  withChildValues,
} from './values.ts';

/** How deep a value nests, by the definition's recursion. */
function recursiveDepth(contents: Value): number {
  return isComposite(contents) ? 1 + Math.max(0, ...childValues(contents).map(recursiveDepth)) : 0;
}

/** The objects a value's handles name, by the definition's recursion: each once, first seen first. */
function recursiveHandles(contents: Value): readonly number[] {
  if (!isComposite(contents)) {
    return [];
  }
  if (contents.kind === 'handle') {
    return [contents.object];
  }
  return [...new Set(childValues(contents).flatMap(recursiveHandles))];
}

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
    const holder: Value = {
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
    expect(handlesIn(holder)).toEqual([3, 5, 8]);
    expect(handlesIn({ kind: 'extern', type: 0, payload: { kind: 'handle', object: 1 } })).toEqual(
      [],
    );
  });
});

describe('deep values', () => {
  it('nest as deep as their deepest part', () => {
    fc.assert(
      fc.property(valueArbitrary({ typed: true, handles: [0, 7] }), (contents) => {
        expect(depthOf(contents)).toBe(recursiveDepth(contents));
      }),
    );
  });

  it('hold handles to each object once, wherever they stand and however often walked', () => {
    fc.assert(
      fc.property(valueArbitrary({ typed: true, handles: [0, 7, 9] }), (contents) => {
        const parts = isComposite(contents) ? childValues(contents) : [];
        parts.forEach(handlesIn);
        expect(handlesIn(contents)).toEqual(recursiveHandles(contents));
      }),
    );
  });

  it('are walked without exhausting the host stack', () => {
    const deep = nested(100_000, { kind: 'handle', object: 4 });
    expect(depthOf(deep)).toBe(100_001);
    expect(handlesIn(deep)).toEqual([4]);
    expect(valueProblems(subsetDefinition, deep)).toEqual([]);
  });
});

describe('a composite value rebuilt from children', () => {
  const composite = valueArbitrary({ typed: true, handles: [0, 7] }).filter(isComposite);

  it('is the value itself when they are its own', () => {
    fc.assert(
      fc.property(composite, (original) => {
        expect(withChildValues(original, childValues(original))).toEqual(original);
      }),
    );
  });

  it('holds exactly the children given, in their order', () => {
    fc.assert(
      fc.property(composite, fc.integer(), (original, seed) => {
        const replaced = childValues(original).map((_, index) => BigInt(seed + index));
        expect(childValues(withChildValues(original, replaced))).toEqual(replaced);
      }),
    );
  });
});
