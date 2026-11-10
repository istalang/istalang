/**
 * Type identity (§3.1): two types are one exactly when their keys are equal, and a shape is its
 * field names and their types, whatever order and place wrote it. The keys are checked against a
 * structural equality written here, over generated types, so "same key" means "same structure".
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { handMadeSpan } from '../../../syntax/tree/tree.test-kit.ts';
import type { StructType } from '../../../syntax/types/index.ts';
import { simpleMark } from '../type/function-kinds.ts';
import { functionType, plainSend } from '../type/function-types.ts';
import { type FieldMember, shapeType, type Type } from '../type/index.ts';
import { boolType, intType, stringType, tupleType, unitType } from '../type/primitives.ts';
import { sameType } from './identity.ts';
import { typeKeys } from './type-keys.ts';

/** A `{…}` type node written at `offset`, standing for where a shape is written. */
function writtenAt(offset: number): StructType {
  return { kind: 'StructType', span: handMadeSpan(offset), fields: [] };
}

const fieldNames = fc.constantFrom('a', 'b', 'x', 'y', 'value');

/** Types built from primitives, tuples, plain functions and shapes, written anywhere. */
const types: fc.Arbitrary<Type> = fc.letrec<{ type: Type }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom(intType, stringType, boolType, unitType),
    fc.array(tie('type'), { minLength: 1, maxLength: 3 }).map(tupleType),
    fc.record({ parameters: fc.array(tie('type'), { maxLength: 2 }), result: tie('type') }).map(
      ({ parameters, result }): Type =>
        functionType({
          send: plainSend,
          mark: simpleMark,
          parameters: parameters.map((type) => ({ type, reference: false })),
          result,
        }),
    ),
    fc
      .record({
        fields: fc.uniqueArray(fc.record({ name: fieldNames, type: tie('type') }), {
          selector: (field) => field.name,
          maxLength: 3,
        }),
        at: fc.nat(9),
      })
      .map(({ fields, at }) => shapeType(writtenAt(at), fields)),
  ),
})).type;

/** Structural equality: a shape by the set of its fields, by name, wherever written. */
function alike(first: Type, second: Type): boolean {
  if (first.kind === 'anonymous' || second.kind === 'anonymous') {
    if (first.kind !== 'anonymous' || second.kind !== 'anonymous') {
      return false;
    }
    const other = new Map(second.fields.map((field) => [field.name, field.type]));
    return (
      first.fields.length === second.fields.length &&
      first.fields.every((field) => {
        const type = other.get(field.name);
        return type !== undefined && alike(field.type, type);
      })
    );
  }
  if (first.kind === 'tuple' && second.kind === 'tuple') {
    return allAlike(first.elements, second.elements);
  }
  if (first.kind === 'function' && second.kind === 'function') {
    return (
      allAlike(
        first.parameters.map((slot) => slot.type),
        second.parameters.map((slot) => slot.type),
      ) && alike(first.result, second.result)
    );
  }
  return first.kind === 'primitive' && second.kind === 'primitive' && first.name === second.name;
}

function allAlike(first: readonly Type[], second: readonly Type[]): boolean {
  return (
    first.length === second.length &&
    first.every((type, index) => alike(type, second[index] ?? type))
  );
}

describe('type identity', () => {
  it('holds exactly when two types have one structure, and keys agree with it', () => {
    fc.assert(
      fc.property(types, types, (first, second) => {
        expect(sameType(first, second)).toBe(alike(first, second));
        expect(typeKeys.typeKey(first) === typeKeys.typeKey(second)).toBe(alike(first, second));
      }),
    );
  });

  it('makes a shape one type however its fields are ordered and wherever it is written', () => {
    const fields = fc.uniqueArray(fc.record({ name: fieldNames, type: types }), {
      selector: (field) => field.name,
      maxLength: 4,
    });
    fc.assert(
      fc.property(fields, fc.nat(9), fc.nat(9), (written, here, there) => {
        const reordered: FieldMember[] = written.toReversed();
        const first = shapeType(writtenAt(here), written);
        const second = shapeType(writtenAt(there), reordered);
        expect(sameType(first, second)).toBe(true);
        expect(typeKeys.typeKey(first)).toBe(typeKeys.typeKey(second));
        expect(first.fields.map((field) => field.name)).toEqual(
          written.map((field) => field.name).toSorted(),
        );
      }),
    );
  });

  it('tells apart shapes of other field names, or another field type', () => {
    const point = shapeType(writtenAt(0), [
      { name: 'x', type: intType },
      { name: 'y', type: intType },
    ]);
    expect(sameType(point, shapeType(writtenAt(0), [{ name: 'x', type: intType }]))).toBe(false);
    expect(
      sameType(
        point,
        shapeType(writtenAt(0), [
          { name: 'x', type: intType },
          { name: 'y', type: stringType },
        ]),
      ),
    ).toBe(false);
  });
});
