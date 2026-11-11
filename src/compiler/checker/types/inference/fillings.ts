/**
 * What a type given a type parameter bounds it by (§3.5): a pack takes only a tuple, `Unit` or a
 * pack; a member parameter (`T in U`) only a type of one member of `U`, a literal of a member's base
 * as that base, a value of several members being for the caller to narrow. And what its lower
 * bounds join to: a fresh literal taken as its base unless an upper bound holds a literal of that
 * base (§2), and for a member parameter the one member they all are.
 */

import type { Fitting } from '../fitting/fit/index.ts';
import { isOneMember } from '../fitting/member-arguments.ts';
import { sameType } from '../identity/identity.ts';
import { fillsPack, isPack } from '../type/function-types.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { isPrimitive } from '../type/primitives.ts';
import { commonType, type Joining } from '../unions/common-type.ts';
import { baseOf } from '../unions/union-members.ts';
import { literalOrBase, unionOf } from '../unions/unions.ts';
import { parameterType } from '../written/resolve-type.ts';
import type { Bound, LowerBound } from './variable-bounds.ts';

/** What `given` fills a parameter with: a type, nothing, or nothing for holding several members. */
export type Filling =
  | { readonly kind: 'fills'; readonly type: Type }
  | { readonly kind: 'none' }
  | { readonly kind: 'severalMembers' };

const fillsNothing: Filling = { kind: 'none' };

/**
 * What `given` fills `parameter` with: itself, unless `parameter` is a pack or a member
 * parameter, `union` being what its own union is so far (types/fitting/member-arguments.ts
 * `isOneMember`).
 */
export function fillingOf(
  parameter: ParameterKey,
  given: Type,
  union: Type | undefined,
  fitting: Fitting,
): Filling {
  if (isPack(parameterType(parameter)) && !fillsPack(given)) {
    return fillsNothing;
  }
  if (union === undefined || given.kind === 'error' || isPrimitive(given, 'Never')) {
    return { kind: 'fills', type: given };
  }
  const memberOf = (type: Type) =>
    [type, baseOf(type)].find((each) => isOneMember(union, each, fitting.memberUnionOf));
  const members = membersOf(given).map(memberOf);
  const [only] = members;
  if (members.length === 1 || only === undefined) {
    return only === undefined ? fillsNothing : { kind: 'fills', type: only };
  }
  return members.every((member) => member !== undefined)
    ? { kind: 'severalMembers' }
    : fillsNothing;
}

/**
 * The type `lower` bounds join to, as the banner says, for a member parameter when `isMember`;
 * undefined when none.
 */
export function joinedLower(
  isMember: boolean,
  lower: readonly LowerBound[],
  upper: readonly Bound[],
  joining: Joining,
): Type | undefined {
  const held =
    upper.length === 0
      ? undefined
      : unionOf(
          upper.map(({ type }) => type),
          joining.typeRules,
        );
  const types = lower.map(({ type, fresh }) =>
    fresh && type.kind === 'literal' ? literalOrBase(type.value, held, joining.fitting) : type,
  );
  if (!isMember) {
    return commonType(types, joining);
  }
  const [first] = types;
  return first !== undefined && types.every((type) => sameType(type, first)) ? first : undefined;
}
