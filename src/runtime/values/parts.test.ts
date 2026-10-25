/**
 * Parts of values along paths: reading back what was written, leaving every other part and the
 * original value untouched, whatever the value's shape and depth (a constant's value is shared by
 * every instance, so a write must never change it in place). Element steps go through the calls
 * they name, here an array's own `index` and `setIndex`, written as natives would be.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { valueArbitrary } from '../../definition/values.test-kit.ts';
import { childValues, isComposite, type Value } from '../../definition/values.ts';
import { type Box, type ElementCalls, isBox, partAt, type ValueStep, withPart } from './parts.ts';

/** Calls for paths of fields only: following one never calls anything. */
const fieldsOnly: ElementCalls = {
  callNow: () => {
    throw new Error('A field path made a call.');
  },
};

/** The elements of an array, given as itself or in a box. */
function elementsOf(container: Value | Box | undefined): readonly Value[] {
  const array = container !== undefined && isBox(container) ? container.value : container;
  if (array === undefined || !isComposite(array) || array.kind !== 'array') {
    throw new TypeError('Not an array.');
  }
  return array.elements;
}

/** Function 0 reads an array element by an int key, function 1 writes one into a boxed array. */
const arrayCalls: ElementCalls = {
  callNow: (callee, [container, key, element]) => {
    const index = Number(key);
    if (callee === 0) {
      return elementsOf(container)[index] as Value;
    }
    const box = container as Box;
    box.value = { kind: 'array', elements: elementsOf(box).with(index, element as Value) };
    return null;
  },
};

const elementStep = (key: bigint): ValueStep => ({ kind: 'element', key, read: 0, write: 1 });

/** The parts a field step reaches in `value`, as the `field` instruction reads them. */
function fieldsOf(value: Value): readonly Value[] {
  return isComposite(value) ? childValues(value) : [];
}

/** Every field path into `value`, the empty path first. */
function fieldPaths(value: Value): ValueStep[][] {
  return [
    [],
    ...fieldsOf(value).flatMap((part, index) =>
      fieldPaths(part).map((rest): ValueStep[] => [{ kind: 'field', index }, ...rest]),
    ),
  ];
}

/** Whether `inner` starts with every step of `outer`. */
function startsWith(inner: readonly ValueStep[], outer: readonly ValueStep[]): boolean {
  return outer.every((step, index) => {
    const other = inner[index];
    return step.kind === 'field' && other?.kind === 'field' && step.index === other.index;
  });
}

const valueWithPath = valueArbitrary({ typed: true }).chain((value) =>
  fc.record({
    value: fc.constant(value),
    path: fc.constantFrom(...fieldPaths(value)),
    part: valueArbitrary({ typed: true }),
  }),
);

describe('parts of values', () => {
  it('reads back the part written at a path', () => {
    fc.assert(
      fc.property(valueWithPath, ({ value, path, part }) => {
        expect(partAt(withPart(value, path, part, fieldsOnly), path, fieldsOnly)).toBe(part);
      }),
    );
  });

  it('never changes the value it writes into', () => {
    fc.assert(
      fc.property(valueWithPath, ({ value, path, part }) => {
        const before = structuredClone(value);
        withPart(value, path, part, fieldsOnly);
        expect(value).toEqual(before);
      }),
    );
  });

  it('leaves every part neither on nor below the path as it was', () => {
    fc.assert(
      fc.property(valueWithPath, ({ value, path, part }) => {
        const written = withPart(value, path, part, fieldsOnly);
        const untouched = fieldPaths(value).filter(
          (other) => !(startsWith(path, other) || startsWith(other, path)),
        );
        for (const other of untouched) {
          expect(partAt(written, other, fieldsOnly)).toBe(partAt(value, other, fieldsOnly));
        }
      }),
    );
  });

  it('refuses a field a value lacks', () => {
    expect(() => partAt(5n, [{ kind: 'field', index: 0 }], fieldsOnly)).toThrow(TypeError);
    const empty: Value = { kind: 'tuple', elements: [] };
    expect(() => partAt(empty, [{ kind: 'field', index: 0 }], fieldsOnly)).toThrow(RangeError);
  });

  it('reads and writes elements through their calls, at any depth below fields', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 9n }), { minLength: 1, maxLength: 6 }),
        fc.nat(),
        fc.bigInt(),
        (items, at, part) => {
          const key = BigInt(at % items.length);
          const array: Value = { kind: 'array', elements: items };
          const value: Value = { kind: 'tuple', elements: [true, array] };
          const path = [{ kind: 'field', index: 1 } as const, elementStep(key)];
          const written = withPart(value, path, part, arrayCalls);
          expect(partAt(written, path, arrayCalls)).toBe(part);
          expect(partAt(value, path, arrayCalls)).toBe(items[Number(key)]);
        },
      ),
    );
  });
});
