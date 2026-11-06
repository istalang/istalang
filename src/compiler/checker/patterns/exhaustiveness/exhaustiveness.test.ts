import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  anyShape,
  type CaseShape,
  type ConstructorKey,
  type ConstructorOf,
  lengthKey,
  longArrays,
  type Shape,
  type Signature,
  sameConstructorKey,
  type WitnessShape,
} from './exhaustiveness.ts';

/**
 * Small types whose values can be listed: `Bool`, enums of such types, tuples of them, arrays of
 * `Bool`, and `Int`, which has no finite signature; its values are the literals cases use, plus one
 * no case names. An array's values are every array of each length below the one past which the
 * analysis takes arrays as one constructor, and every such long array's items it can see.
 */
type TestType =
  | { readonly kind: 'bool' }
  | { readonly kind: 'int' }
  | { readonly kind: 'enum'; readonly variants: readonly (readonly TestType[])[] }
  | { readonly kind: 'tuple'; readonly elements: readonly TestType[] }
  | { readonly kind: 'array' };

const bool: TestType = { kind: 'bool' };

const literals = ['0', '1', '2'];
const unnamedLiteral = 'other';

const signature: Signature<TestType> = (type) => {
  switch (type.kind) {
    case 'bool':
      return [
        { key: 'true', arguments: [] },
        { key: 'false', arguments: [] },
      ];
    case 'int':
      return;
    case 'enum':
      return type.variants.map(
        (fields, index): ConstructorOf<TestType> => ({
          key: `v${index}`,
          arguments: fields,
        }),
      );
    case 'tuple':
      return [{ key: 'tuple', arguments: type.elements }];
    case 'array':
      return { items: bool };
    default:
      return type;
  }
};

const typeArbitrary: fc.Arbitrary<TestType> = fc.letrec<{ type: TestType }>((tie) => ({
  type: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constant({ kind: 'bool' } as const),
    fc.constant({ kind: 'int' } as const),
    fc.record({
      kind: fc.constant('enum' as const),
      variants: fc.array(fc.array(tie('type'), { maxLength: 2 }), { minLength: 1, maxLength: 3 }),
    }),
    fc.record({
      kind: fc.constant('tuple' as const),
      elements: fc.array(tie('type'), { minLength: 1, maxLength: 2 }),
    }),
    fc.constant({ kind: 'array' } as const),
  ),
})).type;

/** Every value of `type`, as a shape with no `any` in it, arrays from `longer` items on as one. */
function valuesOf(type: TestType, longer: number): readonly WitnessShape[] {
  const signed = signature(type);
  if (signed === undefined) {
    return [...literals, unnamedLiteral].map((key) => constructedValue(key, []));
  }
  const constructors: readonly ConstructorOf<TestType, ConstructorKey>[] =
    'items' in signed
      ? [
          ...Array.from({ length: longer }, (_, length) => ({
            key: lengthKey(length),
            arguments: Array.from({ length }, () => signed.items),
          })),
          {
            key: lengthKey(longer, true),
            arguments: Array.from({ length: longer }, () => signed.items),
          },
        ]
      : signed;
  return constructors.flatMap(({ key, arguments: argumentTypes }) =>
    combinations(argumentTypes.map((each) => valuesOf(each, longer))).map((values) =>
      constructedValue(key, values),
    ),
  );
}

function combinations(
  lists: readonly (readonly WitnessShape[])[],
): readonly (readonly WitnessShape[])[] {
  return lists.reduce<readonly (readonly WitnessShape[])[]>(
    (done, list) => done.flatMap((prefix) => list.map((value) => [...prefix, value])),
    [[]],
  );
}

function constructedValue(key: ConstructorKey, values: readonly WitnessShape[]): WitnessShape {
  return { kind: 'constructor', key, arguments: values };
}

function constructed(key: string, values: readonly Shape[]): Shape {
  return { kind: 'constructor', key, arguments: values };
}

/** A random pattern for a value of `type`: anything, a constructor, an array, or alternatives. */
function patternOf(type: TestType): fc.Arbitrary<Shape> {
  const built = builtPatternOf(type);
  const alternatives = fc
    .array(built, { minLength: 2, maxLength: 3 })
    .map((each): Shape => ({ kind: 'or', alternatives: each }));
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant(anyShape) },
    { weight: 3, arbitrary: built },
    { weight: 1, arbitrary: alternatives },
  );
}

/** A random pattern naming how a value of `type` is built: a literal, a constructor or an array. */
function builtPatternOf(type: TestType): fc.Arbitrary<Shape> {
  const signed = signature(type);
  if (signed === undefined) {
    return fc.constantFrom(...literals).map((key) => constructed(key, []));
  }
  if ('items' in signed) {
    return arrayPatterns();
  }
  return fc
    .constantFrom(...signed)
    .chain(({ key, arguments: argumentTypes }) =>
      fc.tuple(...argumentTypes.map(patternOf)).map((values) => constructed(key, values)),
    );
}

/** A random array pattern over `Bool` items. */
function arrayPatterns(): fc.Arbitrary<Shape> {
  const items = fc.array(patternOf(bool), { maxLength: 2 });
  return fc.record({
    kind: fc.constant('array' as const),
    prefix: items,
    suffix: items,
    hasRest: fc.boolean(),
  });
}

/**
 * Whether `pattern` matches `value`. An array value of `longer` items or more holds its first items,
 * then its last ones, so an array pattern reads its prefix from its start and its suffix from its
 * end (exhaustiveness.ts).
 */
function matches(pattern: Shape | WitnessShape, value: WitnessShape): boolean {
  switch (pattern.kind) {
    case 'any':
      return true;
    case 'or':
      return pattern.alternatives.some((alternative) => matches(alternative, value));
    case 'array':
      return matchesArray(pattern, value);
    case 'constructor':
      return (
        value.kind === 'constructor' &&
        sameConstructorKey(value.key, pattern.key) &&
        allMatch(pattern.arguments, value.arguments)
      );
    default: {
      const unhandled: never = pattern;
      return unhandled;
    }
  }
}

function matchesArray(pattern: Extract<Shape, { kind: 'array' }>, value: WitnessShape): boolean {
  if (value.kind !== 'constructor') {
    return false;
  }
  const items = value.arguments;
  const fixed = pattern.prefix.length + pattern.suffix.length;
  const fits = sameConstructorKey(value.key, lengthKey(items.length))
    ? items.length === fixed || (pattern.hasRest && items.length >= fixed)
    : pattern.hasRest;
  return (
    fits &&
    allMatch(pattern.prefix, items.slice(0, pattern.prefix.length)) &&
    allMatch(pattern.suffix, items.slice(items.length - pattern.suffix.length))
  );
}

function allMatch(
  patterns: readonly (Shape | WitnessShape)[],
  values: readonly WitnessShape[],
): boolean {
  return patterns.every((pattern, index) => {
    const value = values[index];
    return value !== undefined && matches(pattern, value);
  });
}

const caseArbitrary = typeArbitrary.chain((type) =>
  fc.tuple(
    fc.constant(type),
    fc.array(fc.record({ shape: patternOf(type), guarded: fc.boolean() }), { maxLength: 5 }),
  ),
);

describe('analyze', () => {
  it('reports the cases no value reaches, as enumerating every value finds them', () => {
    fc.assert(
      fc.property(caseArbitrary, ([type, cases]) => {
        const values = valuesOf(type, longArrays(cases.map(({ shape }) => shape)));
        const reached = (index: number, { shape }: CaseShape) =>
          values.some(
            (value) =>
              matches(shape, value) &&
              !cases
                .slice(0, index)
                .some((before) => !before.guarded && matches(before.shape, value)),
          );
        const expected = cases.flatMap((each, index) => (reached(index, each) ? [] : [index]));
        expect(analyze(signature, type, cases).unreachable).toEqual(expected);
      }),
    );
  });

  it('finds missing values exactly when some value matches no unguarded case', () => {
    fc.assert(
      fc.property(caseArbitrary, ([type, cases]) => {
        const covering = cases.filter(({ guarded }) => !guarded);
        const longer = longArrays(cases.map(({ shape }) => shape));
        const unmatched = valuesOf(type, longer).filter(
          (value) => !covering.some(({ shape }) => matches(shape, value)),
        );
        const { missing } = analyze(signature, type, cases);
        expect(missing.length > 0).toBe(unmatched.length > 0);
        for (const witness of missing) {
          expect(unmatched.some((value) => matches(witness, value))).toBe(true);
        }
      }),
    );
  });

  it('names an unlisted variant rather than anything when an enum is incomplete', () => {
    const color: TestType = { kind: 'enum', variants: [[], [], []] };
    const cases = [{ shape: constructed('v0', []), guarded: false }];
    expect(analyze(signature, color, cases).missing).toEqual([constructed('v1', [])]);
  });

  it('takes literals of a type without a finite signature as never covering it', () => {
    const int: TestType = { kind: 'int' };
    const cases = literals.map((key) => ({ shape: constructed(key, []), guarded: false }));
    expect(analyze(signature, int, cases).missing).toEqual([anyShape]);
  });
});
