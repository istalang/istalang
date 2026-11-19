/**
 * The `DataKind<K in Mark>` trait (proposal 8, Rule 3; §8.4): derived, never declared, met by a
 * type whose kind is one of `K`'s marks, `"simple"` where its values hold no kind
 * (properties/value-kinds.ts). Conformance meets it by this rule
 * (resolution/conformance/derived-traits.ts).
 *
 * - A type parameter's values pass through generic code, and the code naming its type handles them,
 *   so a parameter is of no kind of its own. An associated type of one is named by no caller: its
 *   bounds are all that gives it a kind (`boundKindsOf`). An associated type's bounds hold
 *   `DataKind<"simple">` where none is written (`withKindBound`), as simple is never written, so a
 *   type giving it data of a kind fails where it meets the trait, naming the bound to widen; one
 *   bounded to members instead is of their kinds, which the members say.
 * - A type known by its constraints is of the marks they allow (constraint-implication.ts); any
 *   other is of the kinds its values hold.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { sameType } from '../identity/identity.ts';
import { isSimpleMark, simpleMark } from '../type/function-kinds.ts';
import type { Constraint, Type } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { typeText } from '../type/type-text.ts';
import { isWellKnownTrait } from '../type/well-known.ts';
import { marksAllowedBy } from './constraint-implication.ts';
import { knownConstraints } from './known-constraints.ts';

/**
 * The kinds the values of `type`, a type known by its constraints, may hold: those its bounds
 * allow but `"simple"`; none where none bounds them, as a type parameter's pass through. One
 * bounded to members (`type Mode in Persistence`) is one of them, of their kinds.
 */
export function boundKindsOf(checker: CheckerContext, type: Type): readonly Type[] {
  const members = type.kind === 'associated' ? checker.fitting.memberUnionOf(type) : undefined;
  if (members !== undefined) {
    return checker.valueKindsOf(members);
  }
  const marks = marksAllowedBy(checker, knownConstraints(checker, type)) ?? [];
  return marks.filter((mark) => !isSimpleMark(mark));
}

/**
 * Whether the values of `type`, a type known by its constraints, may be of a kind once it is
 * instantiated: unless its members, or its bounds, allow simple data alone. An unbounded type
 * parameter's may be of whatever kind its argument is.
 */
export function mayBeOfKind(checker: CheckerContext, type: Type): boolean {
  const members = checker.fitting.memberUnionOf(type);
  if (members !== undefined) {
    return checker.valueKindsOf(members).length > 0;
  }
  const marks = marksAllowedBy(checker, knownConstraints(checker, type));
  return marks === undefined || marks.some((mark) => !isSimpleMark(mark));
}

/** An associated type's written bounds, `DataKind<"simple">` among them where none is written. */
export function withKindBound(
  checker: CheckerContext,
  bounds: readonly Constraint[],
): readonly Constraint[] {
  const entity = checker.wellKnownEntity(wellKnown.dataKind);
  if (entity?.kind !== 'type' || entity.declaration.kind !== 'TraitDeclaration') {
    return bounds;
  }
  const trait = entity.declaration;
  return bounds.some((each) => isWellKnownTrait(checker, each.trait, wellKnown.dataKind))
    ? bounds
    : [...bounds, { trait, arguments: [simpleMark] }];
}

/** Whether `constraint` is `DataKind<"simple">`, an associated type's bound where none is written. */
export function isSimpleKindBound(checker: CheckerContext, constraint: Constraint): boolean {
  const [marks] = constraint.arguments;
  return (
    marks !== undefined &&
    isSimpleMark(marks) &&
    isWellKnownTrait(checker, constraint.trait, wellKnown.dataKind)
  );
}

/**
 * What `type` lacks to meet `constraint`, a `DataKind<K>`, in words a diagnostic finishes ("it
 * needs …"); undefined when nothing.
 */
export function lackedKind(
  checker: CheckerContext,
  type: Type,
  constraint: Constraint,
): string | undefined {
  const [wanted] = constraint.arguments;
  if (wanted === undefined) {
    return undefined;
  }
  const allowed = membersOf(wanted);
  const held = checker.valueKindsOf(type);
  const marks =
    marksAllowedBy(checker, knownConstraints(checker, type)) ??
    (held.length === 0 ? [simpleMark] : held);
  return marks.every((mark) => allowed.some((each) => sameType(each, mark)))
    ? undefined
    : `a kind among ${typeText(wanted)}, not ${marks.map(typeText).join(' | ')}`;
}
