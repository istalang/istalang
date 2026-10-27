/**
 * Values built through their declarations: the fields given by name land in declared order,
 * whatever order they are given in and whatever they hold, `unit`'s `null` included; a field left
 * out fails loudly.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { structOf, variantOf } from './declared-values.ts';
import type { TypeDefinition } from './types.ts';
import { valueArbitrary } from './values.test-kit.ts';

const unitType = { kind: 'primitive', name: 'unit' } as const;

const types: readonly TypeDefinition[] = [
  {
    kind: 'struct',
    name: 'main.Pair',
    arguments: [],
    fields: [
      { name: 'first', type: unitType, annotations: [] },
      { name: 'second', type: unitType, annotations: [] },
    ],
  },
  {
    kind: 'enum',
    name: 'prelude.Result',
    arguments: [],
    variants: [
      { name: 'Ok', fields: [{ name: 'value', type: unitType, annotations: [] }] },
      { name: 'Err', fields: [{ name: 'error', type: unitType, annotations: [] }] },
    ],
  },
];

describe('a value built through its declaration', () => {
  it('holds the given fields in declared order, whatever they hold', () => {
    fc.assert(
      fc.property(valueArbitrary(), valueArbitrary(), (first, second) => {
        expect(structOf(types, 0, { second, first })).toEqual({
          kind: 'struct',
          type: 0,
          fields: [first, second],
        });
      }),
    );
  });

  it("holds unit's null as a field, as an instance's unit outcome is", () => {
    expect(variantOf(types, 1, 'Ok', { value: null })).toEqual({
      kind: 'variant',
      type: 1,
      variant: 0,
      fields: [null],
    });
  });

  it('fails loudly on a field left out', () => {
    expect(() => structOf(types, 0, { first: null })).toThrow("No field 'second' is given.");
  });
});
