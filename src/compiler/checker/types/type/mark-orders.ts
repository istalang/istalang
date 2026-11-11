/**
 * The two qualifier orders (proposal 8, Rule 4): `Mark`'s, `"simple"` below `"live"` and
 * `"ista"`, which are apart, and `Sendability`'s, `"sendable"` below `"plain"`. They order these two
 * types alone, not their members as subtypes, so fitting and inference read them here wherever a
 * mark or a `Send` is compared: a function type's slots, and a variable standing for one
 * (types/properties/qualifiers.ts), whose bounds agree and join by its order.
 *
 * A variable among the compared, a mark parameter fixed around the code (`K`), is a member apart
 * from every other but the bottom, which is below it; `Sendability`'s top is above it.
 */

import { distinctItems } from '../../../../foundation/structures/equality.ts';
import type { Type } from './index.ts';
import { markType, sendType } from './primitives.ts';

/** How two types are the same, which may infer them. */
type Same = (first: Type, second: Type) => boolean;

/** An order on a qualifier type's members, as the banner says. */
export interface QualifierOrder {
  /** The least member: what an argument of no bound gives, and below every other. */
  readonly bottom: Type;
  /** Whether `lower` is at or below `upper`. */
  readonly below: (lower: Type, upper: Type, same: Same) => boolean;
  /** The least member at or above each of `types`; undefined where none is. */
  readonly join: (types: readonly Type[], same: Same) => Type | undefined;
  /**
   * Whether an undecided variable of it takes the least member its bounds allow, as a mark does
   * (proposal 8, Rule 3), rather than what consumes its value, as a sendability does.
   */
  readonly settlesLeast: boolean;
}

/**
 * What a type parameter qualifying functions is (types/properties/qualifiers.ts): the order it is of, and
 * whether it may stand for the order's bottom, as `M in Mark` may be `"simple"` and
 * `K in Persistence` may not, so the bottom given where it stands bounds nothing.
 */
export interface QualifierParameter {
  readonly order: QualifierOrder;
  readonly mayBeBottom: boolean;
}

const simpleMarkType: Type = markType('simple');
const sendable: Type = sendType('sendable');
const plain: Type = sendType('plain');

function isLiteral(type: Type, value: string): boolean {
  return type.kind === 'literal' && type.value === value;
}

/** `types` but `bottom`, each once. */
export function aboveBottom(types: readonly Type[], bottom: Type, same: Same): readonly Type[] {
  return distinctItems(
    types.filter((type) => !same(type, bottom)),
    same,
  );
}

/** `Mark`'s order: `"simple"` below every other mark, the rest apart. */
export const markOrder: QualifierOrder = {
  bottom: simpleMarkType,
  below: (lower, upper, same) => isLiteral(lower, 'simple') || same(upper, lower),
  join: (types, same) => {
    const [only, ...others] = aboveBottom(types, simpleMarkType, same);
    return others.length > 0 ? undefined : (only ?? simpleMarkType);
  },
  settlesLeast: true,
};

/** `Sendability`'s order: `"sendable"` below `"plain"`, a variable between them. */
export const sendabilityOrder: QualifierOrder = {
  bottom: sendable,
  below: (lower, upper, same) =>
    isLiteral(lower, 'sendable') || isLiteral(upper, 'plain') || same(upper, lower),
  join: (types, same) => {
    const [only, ...others] = aboveBottom(types, sendable, same);
    return others.length > 0 ? plain : (only ?? sendable);
  },
  settlesLeast: false,
};
