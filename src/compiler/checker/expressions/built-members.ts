/**
 * The member of an expected union a value is built as (§2, types/expected.ts `memberBuilt`), as
 * every expression's check reads it (body-checker.ts `expression`): decided before checking from
 * what the value is known to take, and, for a literal whose own type turned out not to go into the
 * union, again from its checked items, which rebuilds it as that member.
 *
 * A member that is a union again, a recursive one's once unfolded, gives the member of it the value
 * is built as, at any depth, so a value goes into a union inside a union through each in turn.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { AcceptedPart, BodyContext } from '../body-context.ts';
import { memberBuilt } from '../types/expected.ts';
import type { Type } from '../types/type.ts';
import { unfolded } from '../types/type-rules.ts';
import { isBuiltLiteral, openBuildsOf } from './expressions.ts';

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
      fits: (type) => checker.fitOf(type, expected) !== undefined,
    }),
    checker.typeRules,
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
  if (!isBuiltLiteral(node) || context.checker.fitOf(type, expected) !== undefined) {
    return type;
  }
  const member = builtMember(context, node, expected, () => context.checkedPart(node));
  return member === expected ? type : context.rebuild(node, member);
}
