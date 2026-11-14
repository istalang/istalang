/**
 * What constraints imply of one another (§3.10): a type meeting some meets another when it is one
 * of them, or Sendable implied by one requiring it of every type meeting it (`Encodable`,
 * `Decodable`), or Inert implied by Sendable, every sendable type being inert, or `DataKind<K>`
 * implied by Sendable where `K` holds `"simple"`, no sendable value holding a kind, or by a
 * `DataKind` whose marks are all `K`'s (proposal 8, Rule 3). Traits declare no supertraits, so this
 * is all one implies of another. Apart from sendability (sendability.ts), which reads what a type
 * meets, so what reads what a type meets may ask it too.
 */

import {
  type WellKnownDeclaration,
  wellKnown,
} from '../../../../foundation/language/well-known/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { sameConstraint, sameType } from '../identity/identity.ts';
import { simpleMark } from '../type/function-kinds.ts';
import { inertSend, plainSend, sendableSend } from '../type/function-types.ts';
import type { Constraint, Type } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { sendabilityOrder } from '../type/mark-orders.ts';
import { isWellKnownTrait } from '../type/well-known.ts';

/**
 * Whether a type meeting every one of `given` meets `needed` too, whatever the type: `needed` is
 * one of them, or it is Sendable, Inert or a `DataKind` and they imply it.
 */
export function constraintsImply(
  checker: CheckerContext,
  given: readonly Constraint[],
  needed: Constraint,
): boolean {
  if (given.some((each) => sameConstraint(each, needed))) {
    return true;
  }
  const marked = markedSendability(checker, needed);
  if (marked !== undefined) {
    return sendabilityOrder.below(impliedSendability(checker, given), marked, sameType);
  }
  const wanted = marksOf(checker, needed);
  if (wanted === undefined) {
    return false;
  }
  const allowed = marksAllowedBy(checker, given);
  return allowed?.every((mark) => wanted.some((each) => sameType(each, mark))) ?? false;
}

/** The least `Send` a type meeting `given` lets a function capturing it be, by them alone. */
export function impliedSendability(checker: CheckerContext, given: readonly Constraint[]): Type {
  if (meetsOneOf(checker, given, sendableTraits)) {
    return sendableSend;
  }
  return meetsOneOf(checker, given, [wellKnown.inert]) ? inertSend : plainSend;
}

/** The `Send` a marker trait, Sendable or Inert, means where `constraint` names one. */
function markedSendability(checker: CheckerContext, constraint: Constraint): Type | undefined {
  if (isWellKnownTrait(checker, constraint.trait, wellKnown.sendable)) {
    return sendableSend;
  }
  return isWellKnownTrait(checker, constraint.trait, wellKnown.inert) ? inertSend : undefined;
}

/** Whether one of `given` is one of `traits`. */
function meetsOneOf(
  checker: CheckerContext,
  given: readonly Constraint[],
  traits: readonly WellKnownDeclaration[],
): boolean {
  return given.some(({ trait }) => traits.some((each) => isWellKnownTrait(checker, trait, each)));
}

/**
 * The marks a type meeting `given` may be of: those every bound on its kind allows, Sendable
 * allowing `"simple"` alone and each `DataKind` its own; undefined where none bounds its kind.
 */
export function marksAllowedBy(
  checker: CheckerContext,
  given: readonly Constraint[],
): readonly Type[] | undefined {
  const sendable = meetsOneOf(checker, given, sendableTraits) ? [[simpleMark]] : [];
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
