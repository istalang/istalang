/**
 * Compile time computes a constant exactly as running its initializer would: for any well-typed
 * initializer of literals, tuples, arrays and maps, with spreads and repeated keys, the computed
 * top-level constant equals (`==`) the same initializer evaluated in `main`.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { startToEnd, testRuntime } from '../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../compile.test-kit.ts';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

/** A type to write values of, and how source writes it. */
type Shape =
  | { readonly kind: 'int' | 'string' | 'bool' }
  | { readonly kind: 'array'; readonly item: Shape }
  | { readonly kind: 'map'; readonly key: 'int' | 'string'; readonly value: Shape }
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
    fc.constantFrom<Shape>({ kind: 'int' }, { kind: 'string' }, { kind: 'bool' }),
    tie('shape').map((item): Shape => ({ kind: 'array', item })),
    fc
      .record({ key: fc.constantFrom('int' as const, 'string' as const), value: tie('shape') })
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
    case 'int':
      return fc.integer({ min: -3, max: 3 }).map(String);
    case 'string':
      return fc.constantFrom('"a"', '"b"', "'c'");
    case 'bool':
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
  it('equal their initializer run as a local', () => {
    fc.assert(
      fc.property(initializers, ({ type, value }) => {
        const main = [
          `const computed: ${type} = ${value}`,
          '',
          'async fn main() -> Future<bool>:',
          `  const local: ${type} = ${value}`,
          '  computed == local',
        ].join('\n');
        expect(startToEnd(testRuntime(), compiledText(main))).toEqual({
          kind: 'finished',
          outcome: 'true',
        });
      }),
      { numRuns: 40 },
    );
  });

  it('apply one-element tuple conversions recorded on the initializer and its parts', () => {
    const main = [
      'const tupled: (int,) = 3',
      'const untupled: int = (4,)',
      'const nested: Array<(int,)> = [5, (6,)]',
      '',
      'async fn main() -> Future<bool>:',
      '  const localTupled: (int,) = 3',
      '  const localUntupled: int = (4,)',
      '  const localNested: Array<(int,)> = [5, (6,)]',
      '  (tupled, untupled, nested) == (localTupled, localUntupled, localNested)',
    ].join('\n');
    expect(startToEnd(testRuntime(), compiledText(main))).toEqual({
      kind: 'finished',
      outcome: 'true',
    });
  });

  it.each([
    ['an optional wrap', 'const x: int? = 1', '1'],
    ['an enum variant literal', 'const x: int? = Some{1}', 'Some{1}'],
    ['a plain function made async', 'const f: async fn() -> int = fn(): 1', 'fn(): 1'],
    ['a value converted into an any type', 'trait Named {}\nconst a: any Named = 1', '1'],
  ])('refuse %s, which compile time does not compute', (_case, text, spanText) => {
    expect(reported(text)).toEqual(reportedOnce(checkerDiagnostics.notConstant.code, spanText));
  });

  it('do not report 5026 on top of 5218 for a shared struct written without new', () => {
    expect(reported('shared struct Box { n: int }\nconst b = Box{n: 1}')).toEqual(
      reportedOnce(checkerDiagnostics.sharedNeedsNew.code, 'Box'),
    );
  });
});
