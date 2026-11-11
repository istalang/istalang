/**
 * What a type parameter qualifies functions by (proposal 8, Rules 3 and 4): one whose union, as
 * `in` names it, holds only marks (`Mark`'s members) is a mark parameter, one holding only
 * sendabilities a sendability parameter. They are known by what the union holds, whatever spells
 * it, so `Persistence`, an alias of the two kinds and a written subset (`M in "simple" | "live"`)
 * alike make one; each is then a member parameter as any other, its value one member. Code reads
 * the answer through the checker, which keeps it (types/type/function-kinds.ts).
 */

import {
  type Mark,
  persistences,
  sendabilities,
} from '../../../../foundation/language/well-known/index.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Type } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { markOrder, type QualifierParameter, sendabilityOrder } from '../type/mark-orders.ts';

const marks: readonly Mark[] = ['simple', ...persistences];

/**
 * What `parameter` qualifies functions by, read from its union (`memberUnionOf`); undefined for any
 * other parameter.
 */
export function qualifierParameterOf(
  checker: Pick<CheckerContext, 'memberUnionOf'>,
  parameter: TypeParameter,
): QualifierParameter | undefined {
  const union = checker.memberUnionOf(parameter);
  const members = union === undefined ? [] : literalsOf(union);
  if (members === undefined || members.length === 0) {
    return undefined;
  }
  if (members.every((member) => (marks as readonly string[]).includes(member))) {
    return { order: markOrder, mayBeBottom: members.includes('simple') };
  }
  return members.every((member) => (sendabilities as readonly string[]).includes(member))
    ? { order: sendabilityOrder, mayBeBottom: members.includes('sendable') }
    : undefined;
}

/** The String literals `union` holds; undefined where it holds anything else. */
function literalsOf(union: Type): readonly string[] | undefined {
  const values = membersOf(union).map((member) =>
    member.kind === 'literal' && typeof member.value === 'string' ? member.value : undefined,
  );
  return values.every((value) => value !== undefined) ? values : undefined;
}
