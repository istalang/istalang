/**
 * What constraints imply of one another (§3.10): a type meeting some meets another when it is one
 * of them, or Sendable implied by one requiring it of every type meeting it (`Encodable`,
 * `Decodable`), or `DataKind<K>` implied by Sendable where `K` holds `"simple"`, no sendable value
 * holding a kind, or by a `DataKind` whose marks are all `K`'s (proposal 8, Rule 3). Traits declare
 * no supertraits, so this is all one implies of another. Apart from sendability (sendability.ts),
 * which reads what a type meets, so what reads what a type meets may ask it too.
 */

import {
  type WellKnownDeclaration,
  wellKnown,
} from '../../../../foundation/language/well-known/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { sameConstraint, sameType } from '../identity/identity.ts';
import { simpleMark } from '../type/function-kinds.ts';
import type { Constraint, Type } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { isWellKnownTrait } from '../type/well-known.ts';

/**
 * Whether a type meeting every one of `given` meets `needed` too, whatever the type: `needed` is
 * one of them, or it is Sendable or a `DataKind` and they imply it.
 */
export function constraintsImply(
  checker: CheckerContext,
  given: readonly Constraint[],
  needed: Constraint,
): boolean {
  if (given.some((each) => sameConstraint(each, needed))) {
    return true;
  }
  if (isWellKnownTrait(checker, needed.trait, wellKnown.sendable)) {
    return impliesSendable(checker, given);
  }
  const wanted = marksOf(checker, needed);
  if (wanted === undefined) {
    return false;
  }
  const allowed = marksAllowedBy(checker, given);
  return allowed?.every((mark) => wanted.some((each) => sameType(each, mark))) ?? false;
}

/** Whether a type meeting `given` is sendable by them. */
export function impliesSendable(checker: CheckerContext, given: readonly Constraint[]): boolean {
  return given.some(({ trait }) =>
    sendableTraits.some((each) => isWellKnownTrait(checker, trait, each)),
  );
}

/**
 * The marks a type meeting `given` may be of: those every bound on its kind allows, Sendable
 * allowing `"simple"` alone and each `DataKind` its own; undefined where none bounds its kind.
 */
export function marksAllowedBy(
  checker: CheckerContext,
  given: readonly Constraint[],
): readonly Type[] | undefined {
  const sendable = impliesSendable(checker, given) ? [[simpleMark]] : [];
  const [first, ...rest] = [
    ...sendable,
    ...given.flatMap((each) => {
      const marks = marksOf(checker, each);
      return marks === undefined ? [] : [marks];
    }),
  ];
  const inEvery = (mark: Type) => rest.every((marks) => marks.some((each) => sameType(each, mark)));
  return first?.filter(inEvery);
}

/** The marks of `constraint`'s argument where it is `DataKind<K>`, `K`'s members; else undefined. */
function marksOf(checker: CheckerContext, constraint: Constraint): readonly Type[] | undefined {
  const [marks] = constraint.arguments;
  return marks !== undefined && isWellKnownTrait(checker, constraint.trait, wellKnown.dataKind)
    ? membersOf(marks)
    : undefined;
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
