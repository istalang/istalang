/**
 * Fitting by the implicit wrap (§2): a `T` fits `T?`, `T??` and so on by one wrap per level, never
 * the other way round, and only into optionals of the same `T`.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { checkProgram } from '../check.ts';
import { optionalInner, wrapsToFit } from './fit.ts';
import {
  boolType,
  errorType,
  intType,
  neverType,
  stringType,
  type Type,
  unitType,
} from './type.ts';

const checker = checkProgram(stdProgramOf({ main: '' }));
const optional = checker.optionalOf(unitType).entity;

/** `type` wrapped into an optional `levels` times. */
function wrapped(type: Type, levels: number): Type {
  return levels === 0 ? type : checker.optionalOf(wrapped(type, levels - 1));
}

const types: fc.Arbitrary<Type> = fc.letrec<{ type: Type }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom(intType, stringType, boolType, unitType),
    fc
      .array(tie('type'), { minLength: 2, maxLength: 3 })
      .map((elements): Type => ({ kind: 'tuple', elements })),
    fc.record({ parameter: tie('type'), result: tie('type'), reference: fc.boolean() }).map(
      ({ parameter, result, reference }): Type => ({
        kind: 'function',
        isSendable: false,
        isAsync: false,
        parameters: [{ type: parameter, reference }],
        result,
      }),
    ),
  ),
})).type;

const levelCounts = fc.nat(3);

describe('fitting by the implicit wrap', () => {
  it('takes one wrap per optional level', () => {
    fc.assert(
      fc.property(types, levelCounts, (type, count) => {
        expect(wrapsToFit(type, wrapped(type, count), optional)).toBe(count);
      }),
    );
  });

  it('never unwraps: a more optional type fits no less optional one', () => {
    fc.assert(
      fc.property(types, levelCounts, levelCounts, (type, found, expected) => {
        const wraps = wrapsToFit(wrapped(type, found), wrapped(type, expected), optional);
        expect(wraps).toBe(found <= expected ? expected - found : undefined);
      }),
    );
  });

  it('wraps only into optionals of the same type', () => {
    fc.assert(
      fc.property(types, types, levelCounts, (found, inner, count) => {
        fc.pre(wrapsToFit(found, inner, optional) === undefined);
        expect(wrapsToFit(found, wrapped(inner, count), optional)).toBeUndefined();
      }),
    );
  });

  it.each<[string, Type, Type]>([
    ['never fits any type', neverType, wrapped(intType, 2)],
    ['the error type fits any type', errorType, stringType],
    ['any type fits the error type', wrapped(boolType, 1), errorType],
  ])('%s as it is', (_, found, expected) => {
    expect(wrapsToFit(found, expected, optional)).toBe(0);
  });

  it('reads the inner type of an optional, and of nothing else', () => {
    fc.assert(
      fc.property(types, (type) => {
        expect(optionalInner(wrapped(type, 1), optional)).toEqual(type);
        expect(optionalInner(type, optional)).toBeUndefined();
      }),
    );
  });
});
