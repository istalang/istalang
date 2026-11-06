/**
 * Function types ending in a pack (§3.5): substituting a tuple for the pack flattens it into
 * parameters by value, and matching a pack against a function type takes the parameters past the
 * declared ones as their tuple.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TypeParameter } from '../../syntax/declarations.ts';
import { handMadeSpan } from '../../syntax/tree.test-kit.ts';
import { sameShape } from './function-types.ts';
import { sameType } from './identity/identity.ts';
import { boolType, intType, stringType, tupleType, unitType } from './primitives.ts';
import { substitute } from './substitution.ts';
import type { FunctionType, Type } from './type.ts';
import { noProgramRules } from './type-rules.test-kit.ts';

const span = handMadeSpan(0);

/** A pack type parameter, `...A`. */
const packDeclaration: TypeParameter = {
  kind: 'TypeParameter',
  span,
  isPack: true,
  name: { kind: 'Identifier', span, text: 'A' },
  memberOf: undefined,
  constraints: [],
  defaultType: undefined,
};
const pack = { kind: 'parameter', declaration: packDeclaration } as const;

/** `fn(...fixed, ...A) -> Unit`. */
function packed(fixed: readonly Type[]): FunctionType {
  return {
    kind: 'function',
    isSendable: false,
    isAsync: false,
    parameters: fixed.map((type) => ({ type, reference: false })),
    pack,
    result: unitType,
  };
}

/** `fn(...parameters) -> Unit`, every parameter by value. */
function plain(parameters: readonly Type[]): FunctionType {
  return { ...packed(parameters), pack: undefined };
}

const lists = fc.array(fc.constantFrom(intType, stringType, boolType, unitType), { maxLength: 4 });

describe('a function type ending in a pack', () => {
  it('flattens the tuple substituted for it into parameters', () => {
    fc.assert(
      fc.property(lists, lists, (fixed, elements) => {
        const substituted = substitute(
          packed(fixed),
          new Map([[packDeclaration, tupleType(elements)]]),
          noProgramRules,
        );
        expect(sameType(substituted, plain([...fixed, ...elements]))).toBe(true);
      }),
    );
  });

  it('takes the parameters past its fixed ones as their tuple', () => {
    fc.assert(
      fc.property(lists, lists, (fixed, rest) => {
        const found: Type[] = [];
        const parts = (declared: Type, given: Type) => {
          if (declared === pack) {
            found.push(given);
            return true;
          }
          return sameType(declared, given);
        };
        expect(sameShape(packed(fixed), plain([...fixed, ...rest]), parts)).toBe(true);
        expect(found).toEqual([tupleType(rest)]);
      }),
    );
  });

  it('is no plain function type, nor one with more fixed parameters', () => {
    expect(sameType(packed([]), plain([]))).toBe(false);
    expect(sameType(packed([]), packed([intType]))).toBe(false);
    expect(sameType(packed([intType]), packed([intType]))).toBe(true);
  });
});
