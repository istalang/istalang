/**
 * The two qualifier orders as orders: `below` reflexive, antisymmetric and transitive, the bottom
 * below every member, and `join` the least member at or above all it joins, over the members and a
 * variable standing among them.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import { sameType } from '../identity/identity.ts';
import type { Type } from './index.ts';
import { dataKindOrder, type QualifierOrder, sendabilityOrder } from './mark-orders.ts';
import { markType, sendType } from './primitives.ts';

/** A mark parameter fixed around the code, as `K` is in a `K async fn`. */
const variable: Type = {
  kind: 'parameter',
  declaration: { kind: 'TypeParameter', name: { text: 'K' } } as unknown as TypeParameter,
};

const orders: readonly (readonly [string, QualifierOrder, readonly Type[]])[] = [
  ['DataKind', dataKindOrder, [markType('simple'), markType('live'), markType('ista'), variable]],
  ['Sendability', sendabilityOrder, [sendType('sendable'), sendType('plain'), variable]],
];

const implies = (premise: boolean, conclusion: boolean) => !premise || conclusion;

describe.each(orders)("%s's order", (_name, order, members) => {
  const member = fc.constantFrom(...members);
  const below = (lower: Type, upper: Type) => order.below(lower, upper, sameType);

  it('is a partial order with the bottom below every member', () => {
    fc.assert(
      fc.property(member, member, member, (first, second, third) => {
        expect(below(first, first)).toBe(true);
        expect(below(order.bottom, first)).toBe(true);
        expect(implies(below(first, second) && below(second, first), sameType(first, second))).toBe(
          true,
        );
        expect(implies(below(first, second) && below(second, third), below(first, third))).toBe(
          true,
        );
      }),
    );
  });

  it('joins to the least member at or above all it joins, where one is', () => {
    fc.assert(
      fc.property(fc.array(member, { maxLength: 4 }), (joined) => {
        const join = order.join(joined, sameType);
        const bounds = members.filter((each) => joined.every((type) => below(type, each)));
        const least = bounds.filter((each) => bounds.every((other) => below(each, other)));
        expect(join === undefined ? [] : [join]).toEqual(least);
      }),
    );
  });
});
