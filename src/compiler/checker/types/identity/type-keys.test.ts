/**
 * Keys of types holding recursion (§3.17): built from a minimized term graph once per structure,
 * however many type objects spell that structure, and always the key a fresh term graph gives.
 * Checked over spines (tuples, unions, shapes, nominals) around the nodes of generated recursive
 * groups (recursive-types.test-kit.ts); each spine is built twice, as two objects of one structure,
 * as substitution and union construction keep making them.
 */

import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructDeclaration } from '../../../syntax/declarations.ts';
import { handMadeSpan } from '../../../syntax/tree.test-kit.ts';
import { holdsRecursion } from '../parts/type-children.ts';
import { type NominalEntity, shapeType, type Type } from '../type/index.ts';
import { intType, stringType } from '../type/primitives.ts';
import { canonicalKey } from './recursive-terms.ts';
import { bodiesOf, closed, groups } from './recursive-types.test-kit.ts';
import { typeKeys } from './type-keys.ts';

vi.mock(import('./recursive-terms.ts'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, canonicalKey: vi.fn(original.canonicalKey) };
});

const box = {
  declaration: { kind: 'StructDeclaration', name: { text: 'Box' } } as unknown as StructDeclaration,
} as unknown as NominalEntity;

/** A type built around a group's nodes: a node, a primitive, or a structure of spines. */
type Spine =
  | { readonly kind: 'node'; readonly node: number }
  | { readonly kind: 'primitive'; readonly name: 'Int' | 'String' }
  | { readonly kind: 'tuple' | 'union'; readonly parts: readonly Spine[] }
  | { readonly kind: 'shape' | 'box'; readonly part: Spine };

const spines: fc.Arbitrary<Spine> = fc.letrec<{ spine: Spine }>((tie) => ({
  spine: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.record({ kind: fc.constant('node' as const), node: fc.nat({ max: 3 }) }),
    fc.record({
      kind: fc.constant('primitive' as const),
      name: fc.constantFrom('Int' as const, 'String' as const),
    }),
    fc.record({
      kind: fc.constantFrom('tuple' as const, 'union' as const),
      parts: fc.array(tie('spine'), { minLength: 1, maxLength: 3 }),
    }),
    fc.record({ kind: fc.constantFrom('shape' as const, 'box' as const), part: tie('spine') }),
  ),
})).spine;

/** `spine` built as new type objects around `nodes`, a node index past them wrapping around. */
function built(spine: Spine, nodes: readonly Type[]): Type {
  switch (spine.kind) {
    case 'node':
      return nodes[spine.node % nodes.length] ?? intType;
    case 'primitive':
      return spine.name === 'Int' ? { ...intType } : { ...stringType };
    case 'tuple':
      return { kind: 'tuple', elements: spine.parts.map((part) => built(part, nodes)) };
    case 'union':
      return { kind: 'union', members: spine.parts.map((part) => built(part, nodes)) };
    case 'shape':
      return shapeType({ kind: 'StructType', span: handMadeSpan(0), fields: [] }, [
        { name: 'a', type: built(spine.part, nodes) },
      ]);
    default:
      return { kind: 'nominal', entity: box, arguments: [built(spine.part, nodes)] };
  }
}

/** The key a fresh term graph gives `type`, as keying it computed it before any was kept. */
function freshKey(type: Type): string {
  return holdsRecursion(type)
    ? canonicalKey(type, (leaf) => typeKeys.typeKey(leaf), typeKeys.structureKey)
    : typeKeys.typeKey(type);
}

describe('keys of types holding recursion', () => {
  beforeEach(() => {
    vi.mocked(canonicalKey).mockClear();
  });

  it('builds a term graph once per structure, however many objects spell it', () => {
    fc.assert(
      fc.property(groups, spines, (specs, spine) => {
        const nodes = closed(bodiesOf(specs, intType));
        const first = built(spine, nodes);
        const second = built(spine, nodes);
        typeKeys.typeKey(first);
        vi.mocked(canonicalKey).mockClear();
        expect(typeKeys.typeKey(second)).toBe(typeKeys.typeKey(first));
        expect(canonicalKey).not.toHaveBeenCalled();
      }),
      { numRuns: 200 },
    );
  });

  it('keys every type as a fresh term graph does, whatever was keyed before it', () => {
    fc.assert(
      fc.property(groups, fc.array(spines, { minLength: 1, maxLength: 8 }), (specs, written) => {
        const nodes = closed(bodiesOf(specs, intType));
        const types = written.flatMap((spine) => [built(spine, nodes), built(spine, nodes)]);
        for (const type of types) {
          expect(typeKeys.typeKey(type)).toBe(freshKey(type));
        }
      }),
      { numRuns: 200 },
    );
  });
});
