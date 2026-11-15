/**
 * Validation holds what the runtime finds by name to one meaning: an enum's variants, which it
 * finds a value's variant by (definition/values/declared-values.ts), so a union whose members were
 * named alike fails loading rather than reading one member's value as another's.
 */

import { describe, expect, it } from 'vitest';
import { at, editedSubset } from '../definition.test-kit.ts';
import { definitionFormat } from '../definition.ts';
import { refusalOf } from '../formats/format.test-kit.ts';

describe('a Definition', () => {
  it('is refused with two variants of one name in one enum', () => {
    const text = editedSubset((json) => {
      const variant = { name: 'Int', fields: [] };
      (at(json, 'types') as unknown as unknown[]).push({
        kind: 'enum',
        name: '|<Int,String>',
        arguments: [],
        variants: [variant, variant],
      });
    });
    const message = refusalOf(definitionFormat, text);
    expect(message).toContain('Two variants are named "Int"');
    expect(message).toContain('types[1].variants[1].name');
  });
});
