/**
 * Substitution (§3.5) and respelling keep a type they change nothing in: the very object, never a
 * copy, so what is memoized per type object (type-keys.ts, type-children.ts) stays found however
 * often a type is substituted. Checked over generated groups of recursive bodies
 * (recursive-types.test-kit.ts), open and closed, their open slot given a type mentioning no
 * parameter.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { StructDeclaration } from '../../syntax/declarations.ts';
import { handMadeSpan } from '../../syntax/tree.test-kit.ts';
import { bodiesOf, closed, groups, open, showingRules } from './recursive-types.test-kit.ts';
import { substitute } from './substitution.ts';
import {
  intType,
  type NominalEntity,
  shapeType,
  stringType,
  type Type,
  tupleType,
} from './type.ts';
import { unaliased } from './type-parts.ts';

const box = {
  declaration: { kind: 'StructDeclaration', name: { text: 'Box' } } as unknown as StructDeclaration,
} as unknown as NominalEntity;

/** Types mentioning no type parameter: primitives, and shapes, tuples and nominals of them. */
const unparameterized: fc.Arbitrary<Type> = fc.letrec<{ type: Type }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small' },
    fc.constantFrom(intType, stringType),
    fc.array(tie('type'), { minLength: 1, maxLength: 2 }).map(tupleType),
    tie('type').map(
      (type): Type =>
        shapeType({ kind: 'StructType', span: handMadeSpan(0), fields: [] }, [{ name: 'a', type }]),
    ),
    tie('type').map((type): Type => ({ kind: 'nominal', entity: box, arguments: [type] })),
  ),
})).type;

/** Every body of `specs`, open and closed, its open slot `given`. */
function typesOf(specs: Parameters<typeof bodiesOf>[0], given: Type): readonly Type[] {
  const bodies = bodiesOf(specs, given);
  return [...bodies, ...closed(bodies)];
}

describe('substitution', () => {
  it('gives the very type it replaces no parameter in', () => {
    fc.assert(
      fc.property(groups, unparameterized, (specs, given) => {
        for (const type of [given, ...typesOf(specs, given)]) {
          expect(substitute(type, new Map([[open, stringType]]), showingRules)).toBe(type);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('respells a type written through no alias as the very type', () => {
    fc.assert(
      fc.property(groups, unparameterized, (specs, given) => {
        for (const type of [given, ...typesOf(specs, given)]) {
          const bare = unaliased(type);
          expect(unaliased(bare)).toBe(bare);
        }
      }),
      { numRuns: 300 },
    );
  });
});
