/**
 * Parts of values along field paths: reading back what was written, leaving every other part and
 * the original value untouched, whatever the value's shape and depth (a constant's value is
 * shared by every instance, so a write must never change it in place).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { valueArbitrary } from '../../definition/values/values.test-kit.ts';
import { childValues, isComposite, type Value } from '../../definition/values/values.ts';
import { Unreachable } from '../../structures/unreachable.ts';
import { partAt, withPart } from './parts.ts';

/** The parts a field position reaches in `value`, as the `field` instruction reads them. */
function fieldsOf(value: Value): readonly Value[] {
  return isComposite(value) ? childValues(value) : [];
}

/** Every field path into `value`, the empty path first. */
function fieldPaths(value: Value): number[][] {
  return [
    [],
    ...fieldsOf(value).flatMap((part, index) => fieldPaths(part).map((rest) => [index, ...rest])),
  ];
}

/** Whether `inner` starts with every position of `outer`. */
function startsWith(inner: readonly number[], outer: readonly number[]): boolean {
  return outer.every((index, at) => inner[at] === index);
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
        expect(partAt(withPart(value, path, part), path)).toBe(part);
      }),
    );
  });

  it('never changes the value it writes into', () => {
    fc.assert(
      fc.property(valueWithPath, ({ value, path, part }) => {
        const before = structuredClone(value);
        withPart(value, path, part);
        expect(value).toEqual(before);
      }),
    );
  });

  it('leaves every part neither on nor below the path as it was', () => {
    fc.assert(
      fc.property(valueWithPath, ({ value, path, part }) => {
        const written = withPart(value, path, part);
        const untouched = fieldPaths(value).filter(
          (other) => !(startsWith(path, other) || startsWith(other, path)),
        );
        for (const other of untouched) {
          expect(partAt(written, other)).toBe(partAt(value, other));
        }
      }),
    );
  });

  it('refuses a field a value lacks', () => {
    expect(() => partAt(5n, [0])).toThrow(Unreachable);
    const empty: Value = { kind: 'tuple', elements: [] };
    expect(() => partAt(empty, [0])).toThrow(Unreachable);
  });
});
