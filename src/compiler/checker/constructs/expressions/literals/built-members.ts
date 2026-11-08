/**
 * The member of an expected union a value is built as (§2, types/fitting/expected.ts
 * `memberBuilt`), as every expression's check reads it (body-checker.ts `expression`): decided
 * before checking from what the value is known to take, and, for a literal whose own type turned
 * out not to go into the union, again from its checked items, which rebuilds it as that member.
 *
 * A member that is a union again, a recursive one's once unfolded, gives the member of it the value
 * is built as, at any depth, so a value goes into a union inside a union through each in turn.
 *
 * A literal whose own type goes in only with its parts converted (§3.5) is built as the member
 * instead, as it is built where that member alone is expected: `[42]` where a `Tree | String` is
 * expected is an `Array<Tree>` from the start, rebuilt nowhere.
 */

import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { AcceptedPart, BodyContext } from '../../../contexts/body-context.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { memberBuilt } from '../../../types/fitting/expected.ts';
import { unfolded } from '../../../types/type/computed-types.ts';
import type { Type } from '../../../types/type/index.ts';
import { isBuiltLiteral, openBuildsOf } from '../expressions.ts';

/** The type a value read as `part` is built as where `expected` is expected, at any depth. */
export function builtMember(
  context: BodyContext,
  node: Expression,
  expected: Type,
  part: () => AcceptedPart,
): Type {
  const { checker } = context;
  const member = unfolded(
    memberBuilt(expected, node, {
      checker,
      part,
      openBuilds: () => openBuildsOf(context, node),
      fits: (type) => goesInAsBuilt(checker, type, expected),
    }),
  );
  return member !== expected && member.kind === 'union'
    ? builtMember(context, node, member, part)
    : member;
}

/**
 * `node`, checked as `type` where the union `expected` decided no member before checking, built
 * again as the member its checked items build it as, where its own type doesn't go in; `type`
 * otherwise.
 */
export function builtAsChecked(
  context: BodyContext,
  node: Expression,
  type: Type,
  expected: Type,
): Type {
  if (!isBuiltLiteral(node) || goesInAsBuilt(context.checker, type, expected)) {
    return type;
  }
  const member = builtMember(context, node, expected, () => context.checkedPart(node));
  return member === expected ? type : context.rebuild(node, member);
}

/** Whether a value of `type` goes into `expected` with none of its parts converted. */
function goesInAsBuilt(
  checker: Pick<CheckerContext, 'fitOf'>,
  type: Type,
  expected: Type,
): boolean {
  const fit = checker.fitOf(type, expected);
  return fit !== undefined && fit.conversion.kind !== 'parts';
}
