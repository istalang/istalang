/**
 * The common type of several values' types where none is expected (§2, §4): what agreement (an
 * `if`'s branches, a body's tail and its `return`s, a collection literal's items) decides, and
 * inference's settling will.
 *
 * It is one of the types that holds every other one (types/fitting/holds.ts), the first such, so a
 * written type is kept as it is spelled: `Status` for a `Status` and a `"draft"`, `MaybeInt` for a
 * `MaybeInt` and an `Int`, and `Array<Int?>` for an `Array<Int>` and an `Array<Int?>`, whichever
 * comes first. How each value is then fitted, and what that records, is agreement's to decide.
 * Widening reaches inside an optional, so `"a"?` and `"b"` join to `String?`.
 *
 * Failing that, only two joins exist, as in Kotlin, Swift and C#: a literal type into its base,
 * and a type with `None` into its optional. So `1` and `none` join to `Int?`, while `1` and `"a"`
 * have no common type: no other union is ever inferred. `Never`, the type of a producer that
 * leaves, joins anything.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { holds } from '../fitting/holds.ts';
import type { Type } from '../type/index.ts';
import { isPrimitive } from '../type/primitives.ts';
import { literalsBase, optionalInner, optionalOf, presentType } from './unions.ts';
import { widened } from './widening.ts';

/** What joining asks of the program: how a type fits another, and how types are built. */
export type Joining = Pick<CheckerContext, 'fitOf' | 'typeRules' | 'fitting'>;

/** The type `types` join to (the banner); undefined when they have none. */
export function commonType(types: readonly Type[], joining: Joining): Type | undefined {
  const valued = types.filter((type) => !isPrimitive(type, 'Never'));
  return valued.length === 0
    ? undefined
    : (presentJoin(valued, joining) ?? optionalJoin(valued, joining));
}

/**
 * `candidate` when it holds every one of `types`, else its widening by `widen` when that holds
 * every one widened by `joinWidened`; undefined when neither does.
 */
export function orWidened(
  candidate: Type,
  types: readonly Type[],
  joining: Joining,
  widen: (type: Type, joining: Joining) => Type,
): Type | undefined {
  if (holdsAll(candidate, types, joining)) {
    return candidate;
  }
  const wide = widen(candidate, joining);
  const widenedTypes = types.map((type) => joinWidened(type, joining));
  return holdsAll(wide, widenedTypes, joining) ? wide : undefined;
}

/**
 * What `type` holds beside `none`: nothing for `None`, an optional's inner type, else `type`
 * itself.
 */
export function presentPart(type: Type): Type | undefined {
  return isPrimitive(type, 'None') ? undefined : (optionalInner(type) ?? type);
}

/** `type` made optional, or `type` itself when it already holds `none`. */
export function optionalOver(type: Type, joining: Joining): Type {
  const { typeRules } = joining;
  return presentType(type, typeRules) === undefined ? optionalOf(type, typeRules) : type;
}

/**
 * What joining widens a type to (§2): a literal type, a union of literals of one base, or a member
 * parameter standing for one of them, such as a field loop's key (§4), to that base, and a
 * sendable function type to a plain one; an optional's inner type likewise, kept optional.
 */
export function joinWidened(type: Type, joining: Joining): Type {
  return withinOptional(
    type,
    (present) =>
      literalsBase(present) ?? memberBase(present, joining) ?? widened(present, joining.typeRules),
    joining,
  );
}

/**
 * `change` applied to `type`, or, for an optional, to its inner type, made optional again; `type`
 * itself, as it is spelled, when `change` leaves it alone.
 */
export function withinOptional(
  type: Type,
  change: (present: Type) => Type,
  joining: Joining,
): Type {
  const inner = optionalInner(type);
  if (inner === undefined) {
    return change(type);
  }
  const changed = change(inner);
  return changed === inner ? type : optionalOver(changed, joining);
}

/**
 * The first of `types` that holds them all, else the first of them widened that holds them all
 * widened; undefined when none does.
 */
function presentJoin(types: readonly Type[], joining: Joining): Type | undefined {
  const widenedTypes = types.map((type) => joinWidened(type, joining));
  return firstHolder(types, joining) ?? firstHolder(widenedTypes, joining);
}

function firstHolder(types: readonly Type[], joining: Joining): Type | undefined {
  return types.find((candidate) => holdsAll(candidate, types, joining));
}

/**
 * The optional of what `types` hold beside `none` join to, when some of them may be `none`;
 * undefined when none may be, or what they hold has no common type.
 */
function optionalJoin(types: readonly Type[], joining: Joining): Type | undefined {
  if (types.every((type) => presentPart(type) === type)) {
    return undefined;
  }
  const present = types.flatMap((type) => presentPart(type) ?? []);
  const base = presentJoin(present, joining);
  return base === undefined ? undefined : optionalOver(base, joining);
}

function holdsAll(holder: Type, types: readonly Type[], joining: Joining): boolean {
  return types.every((type) => holds(holder, type, joining.fitting));
}

/** The base a member parameter's union of literals has; undefined for any other type. */
function memberBase(type: Type, joining: Joining): Type | undefined {
  const union = joining.fitting.memberUnionOf(type);
  return union === undefined ? undefined : literalsBase(union);
}
