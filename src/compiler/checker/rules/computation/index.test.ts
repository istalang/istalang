/**
 * Compile time computes a constant exactly as running its initializer would: for any well-typed
 * initializer of literals, tuples, arrays and maps, with spreads and repeated keys, the computed
 * top-level constant equals (`==`) the same initializer evaluated in `main`.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { startToEnd, testRuntime } from '../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../compile.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

/** A type to write values of, and how source writes it. */
type Shape =
  | { readonly kind: 'Int' | 'String' | 'Bool' }
  | { readonly kind: 'array'; readonly item: Shape }
  | { readonly kind: 'map'; readonly key: 'Int' | 'String'; readonly value: Shape }
  | { readonly kind: 'tuple'; readonly elements: readonly Shape[] };

function typeText(shape: Shape): string {
  switch (shape.kind) {
    case 'array':
      return `Array<${typeText(shape.item)}>`;
    case 'map':
      return `Map<${shape.key}, ${typeText(shape.value)}>`;
    case 'tuple':
      return `(${shape.elements.map(typeText).join(', ')})`;
    default:
      return shape.kind;
  }
}

const shapes: fc.Arbitrary<Shape> = fc.letrec<{ shape: Shape }>((tie) => ({
  shape: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constantFrom<Shape>({ kind: 'Int' }, { kind: 'String' }, { kind: 'Bool' }),
    tie('shape').map((item): Shape => ({ kind: 'array', item })),
    fc
      .record({ key: fc.constantFrom('Int' as const, 'String' as const), value: tie('shape') })
      .map((parts): Shape => ({ kind: 'map', ...parts })),
    fc.array(tie('shape'), { minLength: 2, maxLength: 3 }).map(
      (elements): Shape => ({
        kind: 'tuple',
        elements,
      }),
    ),
  ),
})).shape;

/** Source text of a value of `shape`; few distinct keys, so maps repeat them. */
function valueText(shape: Shape): fc.Arbitrary<string> {
  switch (shape.kind) {
    case 'Int':
      return fc.integer({ min: -3, max: 3 }).map(String);
    case 'String':
      return fc.constantFrom('"a"', '"b"', "'c'");
    case 'Bool':
      return fc.boolean().map(String);
    case 'array': {
      const item = valueText(shape.item);
      const part = fc.oneof(
        item,
        fc.array(item, { maxLength: 2 }).map((items) => `...[${items.join(', ')}]`),
      );
      return fc.array(part, { maxLength: 4 }).map((parts) => `[${parts.join(', ')}]`);
    }
    case 'map': {
      const entry = fc
        .tuple(valueText({ kind: shape.key }), valueText(shape.value))
        .map(([key, value]) => `${key}: ${value}`);
      const part = fc.oneof(
        entry,
        fc
          .array(entry, { minLength: 1, maxLength: 2 })
          .map((entries) => `...[${entries.join(', ')}]`),
      );
      // A literal with no `key: value` entry is an array (§2), so a map has at least one, or none.
      return fc
        .tuple(fc.array(part, { maxLength: 3 }), entry, fc.nat({ max: 3 }))
        .map(([parts, first, at]) => [...parts.slice(0, at), first, ...parts.slice(at)])
        .chain((parts) => fc.constantFrom(`[${parts.join(', ')}]`, '[:]'));
    }
    case 'tuple':
      return fc
        .tuple(...shape.elements.map(valueText))
        .map((elements) => `(${elements.join(', ')})`);
    default: {
      const unhandled: never = shape;
      return unhandled;
    }
  }
}

const initializers = shapes.chain((shape) =>
  valueText(shape).map((value) => ({ type: typeText(shape), value })),
);

describe('computed constants', () => {
  it('equal their initializer run as a local', async () => {
    await fc.assert(
      fc.asyncProperty(initializers, async ({ type, value }) => {
        const main = [
          `const computed: ${type} = ${value}`,
          '',
          'async fn main() -> Future<Bool>:',
          `  const local: ${type} = ${value}`,
          '  computed == local',
        ].join('\n');
        expect(await startToEnd(testRuntime(), compiledText(main))).toEqual({
          kind: 'finished',
          outcome: 'true',
        });
      }),
      { numRuns: 40 },
    );
  });

  it('apply one-element tuple conversions recorded on the initializer and its parts', async () => {
    const main = [
      'const tupled: (Int,) = 3',
      'const untupled: Int = (4,)',
      'const nested: Array<(Int,)> = [5, (6,)]',
      '',
      'async fn main() -> Future<Bool>:',
      '  const localTupled: (Int,) = 3',
      '  const localUntupled: Int = (4,)',
      '  const localNested: Array<(Int,)> = [5, (6,)]',
      '  (tupled, untupled, nested) == (localTupled, localUntupled, localNested)',
    ].join('\n');
    expect(await startToEnd(testRuntime(), compiledText(main))).toEqual({
      kind: 'finished',
      outcome: 'true',
    });
  });

  it('put a value into a union as one of its members, at any depth', async () => {
    const main = [
      'const wrapped: Int? = 1',
      'const missing: Int? = none',
      'const mixed: Array<Int | String> = [1, "a"]',
      '',
      'async fn main() -> Future<Bool>:',
      '  const localWrapped: Int? = 1',
      '  const localMissing: Int? = none',
      '  const localMixed: Array<Int | String> = [1, "a"]',
      '  (wrapped, missing, mixed) == (localWrapped, localMissing, localMixed)',
    ].join('\n');
    expect(await startToEnd(testRuntime(), compiledText(main))).toEqual({
      kind: 'finished',
      outcome: 'true',
    });
  });

  it.each([
    ['an enum variant literal', 'const x: Result<Int> = Ok(1)', 'Ok(1)'],
    ['a plain function made async', 'const f: async fn() -> Int = fn(): 1', 'fn(): 1'],
    ['a value converted into an any type', 'trait Named {}\nconst a: any Named = 1', '1'],
    [
      'a spread whose items are wrapped',
      'const xs = [1]\nconst ys: Array<Int?> = [...xs]',
      '...xs',
    ],
  ])('refuse %s, which compile time does not compute', (_case, text, spanText) => {
    expect(reported(text)).toEqual(reportedOnce(checkerDiagnostics.notConstant.code, spanText));
  });

  it('do not report 5026 on top of 5218 for a shared struct written without new', () => {
    expect(reported('shared struct Box { n: Int }\nconst b = Box{n: 1}')).toEqual(
      reportedOnce(checkerDiagnostics.sharedNeedsNew.code, 'Box'),
    );
  });
});
