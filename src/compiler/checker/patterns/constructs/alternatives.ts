/**
 * What an or-pattern's alternatives agree on (§3.11): the names they bind, each with one type, and
 * what of the part they select between them, which a name bound to the whole (`A | B as x`) has.
 * The walk takes each alternative (../walk.ts); these rules read what it found.
 *
 * - Alternatives selecting members of the part's union select the union of those members: `case
 *   Int | String as v` binds `v: Int | String`, as far as earlier cases left them (../members.ts
 *   `leftOf`). Alternatives downcasting a part of an `any` type, or selecting literals through it,
 *   select the union of what they select (`case Int | String as v`). Where one selects nothing,
 *   the whole part is bound.
 */

import type { PartBinding, PatternTest } from '../../surface/checked-pattern.ts';
import { sameType } from '../../types/identity/identity.ts';
import type { AnyType, Type } from '../../types/type/index.ts';
import type { TypeRules } from '../../types/type-rules.ts';
import { unionOf } from '../../types/unions/unions.ts';
import { leftOf, unionPart } from '../members.ts';
import type { ValuePart } from '../parts.ts';

/** What of `part` alternatives selecting by `selected`, each its test, select between them. */
export function partSelected(
  part: ValuePart,
  selected: readonly (PatternTest | undefined)[],
  rules: TypeRules,
): ValuePart {
  if (part.type.kind === 'any' && part.narrowedFrom === undefined) {
    return castSelected({ ...part, type: part.type }, selected, rules);
  }
  const union = unionPart(part);
  const members: Type[] = [];
  for (const test of selected) {
    if (union === undefined || test?.kind !== 'member' || test.union !== union) {
      return part;
    }
    members.push(...test.members);
  }
  const type = leftOf(part, members);
  return union === undefined || sameType(type, part.type)
    ? part
    : { type, path: part.path, narrowedFrom: union };
}

/**
 * What of a part of an `any` type alternatives select between them where each downcasts it or
 * selects a literal through it: the union of the types they select, read out of the `any` value;
 * else the whole part.
 */
function castSelected(
  part: ValuePart & { readonly type: AnyType },
  selected: readonly (PatternTest | undefined)[],
  rules: TypeRules,
): ValuePart {
  const types: Type[] = [];
  for (const test of selected) {
    if (test?.kind === 'downcast' && test.from === part.type) {
      types.push(test.to);
    } else if (test?.kind === 'member' && test.union === part.type) {
      types.push(...test.members);
    } else {
      return part;
    }
  }
  return { type: unionOf(types, rules), path: part.path, narrowedFrom: part.type };
}

/**
 * Whether two alternatives bind the same names, each with the same type. A name bound at the error
 * type was reported where its type went wrong, so it agrees with any.
 */
export function sameNames(first: readonly PartBinding[], other: readonly PartBinding[]): boolean {
  const agree = (one: Type, another: Type) =>
    one.kind === 'error' || another.kind === 'error' || sameType(one, another);
  return (
    first.length === other.length &&
    first.every((binding) =>
      other.some((each) => each.name === binding.name && agree(each.type, binding.type)),
    )
  );
}
