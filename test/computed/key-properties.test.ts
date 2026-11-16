/**
 * Properties of key types and mapped struct types (docs/proposals/4-computed-types.md §3, §8) over
 * generated structs, their fields in any declaration order: `keyof` is the field names in name
 * order, a mapped type over a struct's keys is its shape, and `s[k]` read and written through a
 * generic function, instantiated, agrees with the field read and written by name (test/AGENTS.md,
 * commutation), whether the key is one name or several.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { wholeProgramTimeout } from '../../src/compiler/compile.test-kit.ts';
import { compareOrdered } from '../../src/foundation/language/order.ts';
import { compareWrittenTypes, runMain } from '../written-types.test-kit.ts';
import { generatedFieldsArbitrary, sameComputedType } from './computed.test-kit.ts';

describe('keys and mapped types of generated structs', () => {
  it('keyof is the field names, and a mapped type over the keys is the shape', () => {
    fc.assert(
      fc.property(generatedFieldsArbitrary, (fields) => {
        const sorted = fields.toSorted((a, b) => compareOrdered(a.name, b.name));
        const declarations = [
          `struct Gen { ${fields.map((f) => `${f.name}: ${f.type}`).join(', ')} }`,
          `type ShapeGen = { ${fields
            .toReversed()
            .map((f) => `${f.name}: ${f.type}`)
            .join(', ')} }`,
          'type Copy<S is struct> = { [K in keyof S]: S[K] }',
        ];
        const keys = sorted.map((f) => `"${f.name}"`).join(' | ');
        expect(compareWrittenTypes('keyof Gen', keys, declarations)).toEqual(sameComputedType);
        expect(compareWrittenTypes('Copy<Gen>', 'ShapeGen', declarations)).toEqual(
          sameComputedType,
        );
        expect(
          compareWrittenTypes(
            'Gen[keyof Gen]',
            sorted.map((f) => f.type).join(' | '),
            declarations,
          ),
        ).toEqual(sameComputedType);
      }),
      { numRuns: 15 },
    );
  });

  it('reads and writes a field by a generic key as by its name, one key or several', {
    timeout: wholeProgramTimeout,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(generatedFieldsArbitrary, fc.nat(), async (fields, pick) => {
        const field = fields[pick % fields.length] ?? fields[0];
        if (field === undefined) {
          return;
        }
        const declarations = [
          `struct Gen { ${fields.map((f) => `${f.name}: ${f.type}`).join(', ')} }`,
          'fn readAt<S is struct, K in keyof S>(s: S, k: K) -> S[K]: s[k]',
          'fn writeAt<S is struct, K in keyof S>(s: &S, k: K, v: S[K]):',
          '  s[k] = v',
        ];
        const init = fields.map((f) => `${f.name}: ${f.value}`).join(', ');
        const outcome = await runMain(
          'Bool',
          [
            `let s = Gen{${init}}`,
            `const byName = s.${field.name}`,
            `const one = readAt(s, "${field.name}") == byName`,
            `const k: keyof Gen = "${field.name}"`,
            'const several = s[k] == byName',
            `writeAt(&s, "${field.name}", ${field.nextValue})`,
            `const written = s.${field.name} == ${field.nextValue}`,
            'one and several and written',
          ].join('\n  '),
          declarations,
        );
        expect(outcome).toBe(true);
      }),
      { numRuns: 15 },
    );
  });
});
