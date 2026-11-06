/**
 * Compile time's constant forms and the runtime's values show their values to the one `==` and
 * map-key rules (foundation/language/values.ts) through views of their own. Whatever the value,
 * both views must agree on equality, on which keys a map literal collapses and in what order, and
 * on what a lookup finds; NaN and -0 included.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { entryPosition, mapOf, valuesEqual } from '../../../definition/values/equality.ts';
import type { Value } from '../../../definition/values/values.ts';
import type { Primitive } from '../../../foundation/language/values.ts';
import { type ConstantForm, formSemantics } from './constant-form.ts';

/** A value both representations can hold, built into each by `asForm` and `asValue`. */
type Shape =
  | { readonly kind: 'primitive'; readonly value: Primitive }
  | { readonly kind: 'array' | 'tuple'; readonly items: readonly Shape[] }
  | { readonly kind: 'map'; readonly pairs: readonly (readonly [Shape, Shape])[] };

const primitives = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.constantFrom('', 'a', 'b'),
  fc.bigInt({ min: -2n, max: 2n }),
  fc.constantFrom(0, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY),
);

const shapes = fc.letrec<{ shape: Shape }>((tie) => ({
  shape: fc.oneof(
    { depthSize: 'small', maxDepth: 3 },
    primitives.map((value): Shape => ({ kind: 'primitive', value })),
    fc.array(tie('shape'), { maxLength: 3 }).map((items): Shape => ({ kind: 'array', items })),
    fc.array(tie('shape'), { maxLength: 3 }).map((items): Shape => ({ kind: 'tuple', items })),
    fc
      .array(fc.tuple(tie('shape'), tie('shape')), { maxLength: 4 })
      .map((pairs): Shape => ({ kind: 'map', pairs })),
  ),
})).shape;

const pairsOfShapes = fc.array(fc.tuple(shapes, shapes), { maxLength: 6 });

function asForm(shape: Shape): ConstantForm {
  switch (shape.kind) {
    case 'primitive':
      return shape;
    case 'map':
      return formSemantics.mapOf(shape.pairs.map(([key, value]) => [asForm(key), asForm(value)]));
    default:
      return { kind: shape.kind, elements: shape.items.map(asForm) };
  }
}

function asValue(shape: Shape): Value {
  switch (shape.kind) {
    case 'primitive':
      return shape.value;
    case 'map':
      return mapOf(shape.pairs.map(([key, value]) => [asValue(key), asValue(value)]));
    default:
      return { kind: shape.kind, elements: shape.items.map(asValue) };
  }
}

/** A form of the shapes above as the runtime holds the same value. */
function formAsValue(form: ConstantForm): Value {
  switch (form.kind) {
    case 'primitive':
      return form.value;
    case 'map':
      return {
        kind: 'map',
        entries: form.entries.map(([key, entry]) => [formAsValue(key), formAsValue(entry)]),
      };
    case 'array':
    case 'tuple':
      return { kind: form.kind, elements: form.elements.map(formAsValue) };
    default:
      throw new TypeError(`No ${form.kind} among the shapes.`);
  }
}

describe('constant forms and runtime values', () => {
  it('agree on equality', () => {
    fc.assert(
      fc.property(shapes, shapes, (first, second) => {
        expect(formSemantics.equal(asForm(first), asForm(second))).toBe(
          valuesEqual(asValue(first), asValue(second)),
        );
      }),
    );
  });

  it('agree on the keys a map keeps, their order, and what a lookup finds', () => {
    fc.assert(
      fc.property(pairsOfShapes, shapes, (pairs, probe) => {
        const form = formSemantics.mapOf(pairs.map(([key, entry]) => [asForm(key), asForm(entry)]));
        const value = mapOf(pairs.map(([key, entry]) => [asValue(key), asValue(entry)]));
        expect(formAsValue(form)).toEqual(value);
        expect(formSemantics.entryPosition(form, asForm(probe))).toBe(
          entryPosition(value, asValue(probe)),
        );
      }),
    );
  });
});
