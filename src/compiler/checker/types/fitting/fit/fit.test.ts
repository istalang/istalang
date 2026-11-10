/**
 * Fitting by the implicit conversions (§2, §3.1, §3.14, §3.15): a `T` fits `T?`, `T??` and so on
 * by one wrap per level, never the other way round, and only into optionals of the same `T`; a
 * function fits one giving a future of its result, made async, and an async one fits one giving
 * a future of a type its own future's value fits, converted part by part; a one-element tuple and its
 * element fit each other, and a struct's value its shape, whatever order either writes its
 * fields in, but never inside another type, from a shape, or for a struct with an annotated field.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reported } from '../../../check.test-kit.ts';
import { functionType, type Reach } from '../../type/function-types.ts';
import type { Type } from '../../type/index.ts';
import {
  boolType,
  errorType,
  intType,
  neverType,
  stringType,
  unitType,
} from '../../type/primitives.ts';
import { optionalInner, optionalOf, unionOf } from '../../unions/unions.ts';
import { fittingApart } from './fit.test-kit.ts';
import { type Fit, fitOf } from './index.ts';

/**
 * How a value of `found` fits `expected`: as it is (0), put into a union (1), or not (undefined).
 */
function levelsInto(found: Type, expected: Type): number | undefined {
  const fit = fitOf(found, expected, fittingApart);
  return fit === undefined ? undefined : Number(fit.into !== undefined);
}

/** A fit as these tests compare it: its conversion, and whether it puts the value into a union. */
function fitShape(fit: Fit | undefined) {
  return fit === undefined
    ? undefined
    : { conversion: fit.conversion, into: fit.into !== undefined };
}

/**
 * How a value made optional `found` times fits one made optional `expected` times: as it is when
 * both are optional or neither is, into the union when only the expected one is, else not at all.
 */
function levelsBetween(found: number, expected: number): number | undefined {
  if (found === 0) {
    return Math.min(expected, 1);
  }
  return expected === 0 ? undefined : 0;
}

/** `type` made optional `levels` times, which is once for any `levels` above none (§2). */
function wrapped(type: Type, levels: number): Type {
  return levels === 0 ? type : optionalOf(wrapped(type, levels - 1), fittingApart);
}

const types: fc.Arbitrary<Type> = fc.letrec<{ type: Type }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom(intType, stringType, boolType, unitType),
    fc
      .array(tie('type'), { minLength: 2, maxLength: 3 })
      .map((elements): Type => ({ kind: 'tuple', elements })),
    fc.record({ parameter: tie('type'), result: tie('type'), reference: fc.boolean() }).map(
      ({ parameter, result, reference }): Type =>
        functionType({
          reach: 'plain',
          parameters: [{ type: parameter, reference }],
          result,
        }),
    ),
  ),
})).type;

const levelCounts = fc.nat(3);

describe('fitting into an optional, a union holding None', () => {
  it('puts a value into an optional of its type once, however often it was made optional', () => {
    fc.assert(
      fc.property(types, levelCounts, (type, count) => {
        expect(levelsInto(type, wrapped(type, count))).toBe(Math.min(count, 1));
      }),
    );
  });

  it('never unwraps: an optional fits none of its members, and nested optionals are one', () => {
    fc.assert(
      fc.property(types, levelCounts, levelCounts, (type, found, expected) => {
        const levels = levelsInto(wrapped(type, found), wrapped(type, expected));
        expect(levels).toBe(levelsBetween(found, expected));
      }),
    );
  });

  it('puts a value only into an optional of its own type', () => {
    fc.assert(
      fc.property(types, types, levelCounts, (found, inner, count) => {
        fc.pre(levelsInto(found, inner) === undefined);
        expect(levelsInto(found, wrapped(inner, count))).toBeUndefined();
      }),
    );
  });

  it.each<[string, Type, Type]>([
    ['never fits any type', neverType, wrapped(intType, 2)],
    ['the error type fits any type', errorType, stringType],
    ['any type fits the error type', wrapped(boolType, 1), errorType],
  ])('%s as it is', (_, found, expected) => {
    expect(levelsInto(found, expected)).toBe(0);
  });

  it('reads the inner type of an optional, and of nothing else', () => {
    fc.assert(
      fc.property(types, (type) => {
        expect(optionalInner(wrapped(type, 1))).toEqual(type);
        expect(optionalInner(type)).toBeUndefined();
      }),
    );
  });
});

/**
 * A function type taking `parameter` and giving `result`, sendable or not, async or not: an async
 * one's type gives a future of `result` (§3.14).
 */
function functionOf(
  parameter: Type,
  result: Type,
  { isAsync, reach }: { readonly isAsync: boolean; readonly reach: Reach },
): Type {
  return functionType({
    reach,
    parameters: [{ type: parameter, reference: false }],
    result: isAsync ? fittingApart.futureOf(result) : result,
  });
}

const kinds = fc.record({
  isAsync: fc.boolean(),
  reach: fc.constantFrom<Reach>('sendable', 'plain'),
});

/** Two function types of one shape: the one given, the one expected, wrapped `count` times. */
const pairs = fc.record({
  parameter: types,
  result: types,
  given: kinds,
  wanted: kinds,
  count: levelCounts,
});

describe('fitting a function where one giving a future is expected', () => {
  it('makes a plain function async before any wrap, and an async one never plain', () => {
    fc.assert(
      fc.property(pairs, ({ parameter, result, given, wanted, count }) => {
        const found = functionOf(parameter, result, given);
        const expected = wrapped(functionOf(parameter, result, wanted), count);
        const sendableFits = given.reach === 'sendable' || wanted.reach === 'plain';
        const fits = sendableFits && (given.isAsync === wanted.isAsync || wanted.isAsync);
        expect(fitShape(fitOf(found, expected, fittingApart))).toEqual(
          fits
            ? {
                conversion: { kind: !given.isAsync && wanted.isAsync ? 'async' : 'none' },
                into: count > 0,
              }
            : undefined,
        );
      }),
    );
  });

  it('makes a function inside another type async as a part of it (§3.5)', () => {
    const plain = functionOf(intType, intType, { isAsync: false, reach: 'plain' });
    const async = functionOf(intType, intType, { isAsync: true, reach: 'plain' });
    const tuple = (element: Type): Type => ({ kind: 'tuple', elements: [element, intType] });
    expect(fitShape(fitOf(tuple(plain), tuple(async), fittingApart))).toEqual({
      conversion: { kind: 'parts', to: tuple(async) },
      into: false,
    });
  });

  it('awaits an async function where one giving a future of a wider value is expected', () => {
    const async = functionOf(intType, intType, { isAsync: true, reach: 'plain' });
    const wider = functionOf(intType, wrapped(intType, 1), { isAsync: true, reach: 'plain' });
    expect(fitShape(fitOf(async, wider, fittingApart))).toEqual({
      conversion: { kind: 'parts', to: wider },
      into: false,
    });
    expect(fitOf(wider, async, fittingApart)).toBeUndefined();
  });

  it('fits a function returning never where any result type is expected', () => {
    fc.assert(
      fc.property(pairs, ({ parameter, result, given, wanted, count }) => {
        const found = functionOf(parameter, neverType, given);
        const expected = wrapped(functionOf(parameter, result, wanted), count);
        const sendableFits = given.reach === 'sendable' || wanted.reach === 'plain';
        // A future of `Never` is one of any value; `Never` itself goes into one only made async.
        const fits = sendableFits && (given.isAsync === wanted.isAsync || wanted.isAsync);
        expect(fitShape(fitOf(found, expected, fittingApart))).toEqual(
          fits
            ? {
                conversion: { kind: !given.isAsync && wanted.isAsync ? 'async' : 'none' },
                into: count > 0,
              }
            : undefined,
        );
      }),
    );
  });
});

/** The one-element tuple of `type`. */
function single(type: Type): Type {
  return { kind: 'tuple', elements: [type] };
}

describe('fitting between a one-element tuple and its element', () => {
  it('converts each into the other before putting it into an optional', () => {
    fc.assert(
      fc.property(types, levelCounts, (type, count) => {
        expect(fitShape(fitOf(type, wrapped(single(type), count), fittingApart))).toEqual({
          conversion: { kind: 'tupled' },
          into: count > 0,
        });
        expect(fitShape(fitOf(single(type), wrapped(type, count), fittingApart))).toEqual({
          conversion: { kind: 'untupled' },
          into: count > 0,
        });
      }),
    );
  });

  it('converts once, and never inside another type', () => {
    fc.assert(
      fc.property(types, (type) => {
        expect(fitOf(type, single(single(type)), fittingApart)).toBeUndefined();
        expect(fitOf(single(single(type)), type, fittingApart)).toBeUndefined();
        expect(fitOf(wrapped(single(type), 1), wrapped(type, 1), fittingApart)).toBeUndefined();
      }),
    );
  });
});

describe("a struct's value where its shape is expected (§3.1)", () => {
  const fieldTypes = ['Int', 'String', 'Bool', 'Array<Int>', '(Int, String)'];
  /** Distinct fields, each a name and a type, and the same fields in another order. */
  const fields = fc
    .uniqueArray(fc.constantFrom('a', 'b', 'id', 'x', 'y', 'value'), { minLength: 1, maxLength: 5 })
    .chain((names) =>
      fc.record({
        written: fc.tuple(
          ...names.map((name) =>
            fc.constantFrom(...fieldTypes).map((written) => [name, written] as const),
          ),
        ),
        order: fc.shuffledSubarray(names, { minLength: names.length, maxLength: names.length }),
      }),
    );
  const listed = (written: readonly (readonly [string, string])[]) =>
    written.map(([name, spelled]) => `${name}: ${spelled}`).join(', ');

  it('converts, whatever order the struct and the shape write the fields in', () => {
    fc.assert(
      fc.property(fields, ({ written, order }) => {
        const typeOf = new Map(written);
        const reordered = order.map((name) => [name, typeOf.get(name) ?? 'Int'] as const);
        const text = [
          `struct S { ${listed(written)} }`,
          `fn f(p: { ${listed(reordered)} }) -> Int: 0`,
          'fn g(s: S) -> Int: f(s)',
        ].join('\n');
        expect(reported(text).codes).toEqual([]);
      }),
    );
  });

  it('converts it inside a collection, and refuses it from a shape and for an annotated field', () => {
    fc.assert(
      fc.property(fields, ({ written }) => {
        const declared = `struct S { ${listed(written)} }`;
        const shape = `{ ${listed(written)} }`;
        const [first, ...rest] = written;
        const annotated = `struct A { ${[`${first?.[0]}: ${first?.[1]} @Mark`, ...rest.map(([name, type]) => `${name}: ${type}`)].join(', ')} }`;
        const text = [
          'struct Mark',
          declared,
          annotated,
          `fn all(p: Array<${shape}>) -> Int: 0`,
          'fn one(s: S) -> Int: 0',
          `fn shape(p: ${shape}) -> Int: 0`,
          `fn g(s: Array<S>, p: ${shape}, a: A) -> Int: all(s) + one(p) + shape(a)`,
        ].join('\n');
        expect(reported(text).codes).toEqual([5001, 5001]);
      }),
    );
  });
});

describe('a union where a union holding an `any` type is expected (§6)', () => {
  it('converts whole into the one any member each of its members meets, then goes into it', () => {
    const any: Type = { kind: 'any', constraints: [] };
    const union = unionOf([intType, stringType], fittingApart);
    const meeting = { ...fittingApart, meetsAny: () => true };
    expect(fitShape(fitOf(union, optionalOf(any, fittingApart), meeting))).toEqual({
      conversion: { kind: 'any', to: any },
      into: true,
    });
    expect(fitOf(union, optionalOf(any, fittingApart), fittingApart)).toBeUndefined();
  });
});
