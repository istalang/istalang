/**
 * Fitting by the implicit conversions (§2, §3.14): a `T` fits `T?`, `T??` and so on by one wrap
 * per level, never the other way round, and only into optionals of the same `T`; a plain function
 * fits an async one of its parameters and result, made async, but never inside another type.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { checkProgram } from '../check.ts';
import { fitOf, optionalInner } from './fit.ts';
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

/** Fitting in a program no `any` type is met in. */
const fitting = { optional, meetsAny: () => false };

/** How many wraps make `found` fit `expected`; undefined when nothing does. */
function wrapsToFit(found: Type, expected: Type): number | undefined {
  return fitOf(found, expected, fitting)?.wraps;
}

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
        expect(wrapsToFit(type, wrapped(type, count))).toBe(count);
      }),
    );
  });

  it('never unwraps: a more optional type fits no less optional one', () => {
    fc.assert(
      fc.property(types, levelCounts, levelCounts, (type, found, expected) => {
        const wraps = wrapsToFit(wrapped(type, found), wrapped(type, expected));
        expect(wraps).toBe(found <= expected ? expected - found : undefined);
      }),
    );
  });

  it('wraps only into optionals of the same type', () => {
    fc.assert(
      fc.property(types, types, levelCounts, (found, inner, count) => {
        fc.pre(wrapsToFit(found, inner) === undefined);
        expect(wrapsToFit(found, wrapped(inner, count))).toBeUndefined();
      }),
    );
  });

  it.each<[string, Type, Type]>([
    ['never fits any type', neverType, wrapped(intType, 2)],
    ['the error type fits any type', errorType, stringType],
    ['any type fits the error type', wrapped(boolType, 1), errorType],
  ])('%s as it is', (_, found, expected) => {
    expect(wrapsToFit(found, expected)).toBe(0);
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

/** A function type taking `parameter` and giving `result`, plain or async, sendable or not. */
function functionOf(
  parameter: Type,
  result: Type,
  kind: { readonly isAsync: boolean; readonly isSendable: boolean },
): Type {
  return {
    kind: 'function',
    ...kind,
    parameters: [{ type: parameter, reference: false }],
    result,
  };
}

const kinds = fc.record({ isAsync: fc.boolean(), isSendable: fc.boolean() });

/** Two function types of one shape: the one given, the one expected, wrapped `count` times. */
const pairs = fc.record({
  parameter: types,
  result: types,
  given: kinds,
  wanted: kinds,
  count: levelCounts,
});

describe('fitting a plain function where an async one is expected', () => {
  it('makes a plain function async before any wrap, and an async one never plain', () => {
    fc.assert(
      fc.property(pairs, ({ parameter, result, given, wanted, count }) => {
        const found = functionOf(parameter, result, given);
        const expected = wrapped(functionOf(parameter, result, wanted), count);
        const sendableFits = given.isSendable || !wanted.isSendable;
        const fits = sendableFits && (given.isAsync === wanted.isAsync || wanted.isAsync);
        expect(fitOf(found, expected, fitting)).toEqual(
          fits
            ? {
                conversion: { kind: !given.isAsync && wanted.isAsync ? 'async' : 'none' },
                wraps: count,
              }
            : undefined,
        );
      }),
    );
  });

  it('converts only the value itself, never a function inside another type', () => {
    const plain = functionOf(intType, intType, { isAsync: false, isSendable: false });
    const async = functionOf(intType, intType, { isAsync: true, isSendable: false });
    const tuple = (element: Type): Type => ({ kind: 'tuple', elements: [element, intType] });
    expect(fitOf(tuple(plain), tuple(async), fitting)).toBeUndefined();
  });
});
