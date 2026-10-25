import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  anyShape,
  type CaseShape,
  type ConstructorOf,
  type Shape,
  type Signature,
} from './exhaustiveness.ts';

/**
 * Small types whose values can be listed: `bool`, enums of such types, tuples of them, and `int`,
 * which has no finite signature; its values are the literals cases use, plus one no case names.
 */
type TestType =
  | { readonly kind: 'bool' }
  | { readonly kind: 'int' }
  | { readonly kind: 'enum'; readonly variants: readonly (readonly TestType[])[] }
  | { readonly kind: 'tuple'; readonly elements: readonly TestType[] };

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
  ),
})).type;

/** Every value of `type`, as a shape with no `any` in it. */
function valuesOf(type: TestType): readonly Shape[] {
  const constructors = signature(type);
  if (constructors === undefined) {
    return [...literals, unnamedLiteral].map((key) => constructed(key, []));
  }
  return constructors.flatMap(({ key, arguments: argumentTypes }) =>
    combinations(argumentTypes.map(valuesOf)).map((values) => constructed(key, values)),
  );
}

function combinations(lists: readonly (readonly Shape[])[]): readonly (readonly Shape[])[] {
  return lists.reduce<readonly (readonly Shape[])[]>(
    (done, list) => done.flatMap((prefix) => list.map((value) => [...prefix, value])),
    [[]],
  );
}

function constructed(key: string, values: readonly Shape[]): Shape {
  return { kind: 'constructor', key, arguments: values };
}

/** A random pattern for a value of `type`. */
function patternOf(type: TestType): fc.Arbitrary<Shape> {
  const constructors = signature(type);
  const built =
    constructors === undefined
      ? fc.constantFrom(...literals).map((key) => constructed(key, []))
      : fc
          .constantFrom(...constructors)
          .chain(({ key, arguments: argumentTypes }) =>
            fc.tuple(...argumentTypes.map(patternOf)).map((values) => constructed(key, values)),
          );
  return fc.oneof({ weight: 1, arbitrary: fc.constant(anyShape) }, { weight: 2, arbitrary: built });
}

function matches(pattern: Shape, value: Shape): boolean {
  if (pattern.kind === 'any') {
    return true;
  }
  return (
    value.kind === 'constructor' &&
    value.key === pattern.key &&
    pattern.arguments.every((argument, index) => {
      const part = value.arguments[index];
      return part !== undefined && matches(argument, part);
    })
  );
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
        const values = valuesOf(type);
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
        const unmatched = valuesOf(type).filter(
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
