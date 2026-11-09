/**
 * What constraints imply of one another (§3.10): a type meeting some meets another when it is one of
 * them, or Sendable implied by one requiring it of every type meeting it (`Encodable`, `Decodable`).
 * Traits declare no supertraits, so this is all one implies of another. Apart from sendability
 * (sendable.ts), which reads what a type meets, so what reads what a type meets may ask it too.
 */

import {
  type WellKnownDeclaration,
  wellKnown,
} from '../../../../foundation/language/well-known/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { sameConstraint } from '../identity/identity.ts';
import type { Constraint } from '../type/index.ts';
import { isWellKnownTrait } from '../type/well-known.ts';

/**
 * Whether a type meeting every one of `given` meets `needed` too, whatever the type: `needed` is
 * one of them, or it is Sendable and one of them implies it. Traits declare no supertraits, so
 * this is all constraints imply of one another.
 */
export function constraintsImply(
  checker: CheckerContext,
  given: readonly Constraint[],
  needed: Constraint,
): boolean {
  return (
    given.some((each) => sameConstraint(each, needed)) ||
    (isWellKnownTrait(checker, needed.trait, wellKnown.sendable) && impliesSendable(checker, given))
  );
}

/** Whether a type meeting `given` is sendable by them. */
export function impliesSendable(checker: CheckerContext, given: readonly Constraint[]): boolean {
  return given.some(({ trait }) =>
    sendableTraits.some((each) => isWellKnownTrait(checker, trait, each)),
  );
}

/**
 * The traits a type parameter may be constrained by to be sendable: Sendable, and those that
 * imply it, which require it of every type meeting them (resolution/conformance/derived-traits.ts).
 */
const sendableTraits: readonly WellKnownDeclaration[] = [
  wellKnown.sendable,
  wellKnown.encodable,
  wellKnown.decodable,
];
