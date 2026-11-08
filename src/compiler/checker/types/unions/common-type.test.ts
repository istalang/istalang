/**
 * The common type (§2, §4): the two joins, a literal type into its base and a type with `None`
 * into its optional, in any order, and no other union.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitOf } from '../fitting/fit/index.ts';
import { sameType } from '../identity/identity.ts';
import type { Type } from '../type/index.ts';
import { intType, neverType, noneType, stringType } from '../type/primitives.ts';
import { noProgramRules } from '../type/type-rules.test-kit.ts';
import { commonType, type Joining } from './common-type.ts';
import { literalType, optionalOf, unionOf } from './unions.ts';

const fitting = {
  ...noProgramRules,
  meetsAny: () => false,
  shapeOf: () => undefined,
  memberUnionOf: () => undefined,
  varianceOf: () => [],
};

/** Joining in a program declaring nothing. */
const joining: Joining = {
  fitOf: (found, expected) => fitOf(found, expected, fitting),
  typeRules: noProgramRules,
  fitting,
};

const optionalInt = optionalOf(intType, noProgramRules);

function joined(...types: readonly Type[]): Type | undefined {
  return commonType(types, joining);
}

describe('commonType', () => {
  it('joins a type with None into its optional, in either order', () => {
    expect(joined(intType, noneType)).toEqual(optionalInt);
    expect(joined(noneType, intType)).toEqual(optionalInt);
    expect(joined(intType, optionalInt)).toEqual(optionalInt);
  });

  it('keeps a written optional as it is spelled, rather than building one', () => {
    const written: Type = { ...optionalInt };
    expect(joined(intType, written, noneType)).toBe(written);
  });

  it('keeps a union of literals that holds the others, whichever comes first', () => {
    const status = unionOf([literalType('draft'), literalType('sent')], noProgramRules);
    expect(joined(status, literalType('draft'))).toBe(status);
    expect(joined(literalType('draft'), status)).toBe(status);
    expect(joined(literalType('draft'), noneType, status)).toEqual(
      optionalOf(status, noProgramRules),
    );
  });

  it('joins literal types of one base into it, inside the optional too', () => {
    expect(joined(literalType(1n), literalType(2n))).toEqual(intType);
    expect(joined(literalType('a'), noneType, literalType('b'))).toEqual(
      optionalOf(stringType, noProgramRules),
    );
  });

  it('infers no other union', () => {
    expect(joined(intType, stringType)).toBeUndefined();
    expect(joined(intType, noneType, stringType)).toBeUndefined();
  });

  it('lets Never join anything, and has nothing to join without a value', () => {
    expect(joined(neverType, intType)).toEqual(intType);
    expect(joined(neverType)).toBeUndefined();
    expect(joined()).toBeUndefined();
    expect(joined(noneType, noneType)).toEqual(noneType);
  });

  it('is the same whatever order the types come in', () => {
    const pool = [intType, noneType, optionalInt, literalType(1n), neverType];
    const types = fc.array(fc.constantFrom(...pool), { minLength: 1, maxLength: 5 });
    fc.assert(
      fc.property(types, (some) => {
        const forward = joined(...some);
        const backward = joined(...some.toReversed());
        expect(
          forward === undefined
            ? backward === undefined
            : backward !== undefined && sameType(forward, backward),
        ).toBe(true);
      }),
    );
  });
});
