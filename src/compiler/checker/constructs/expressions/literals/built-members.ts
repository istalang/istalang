/**
 * The member of an expected union a value is built as (§2, types/fitting/expected.ts
 * `memberBuilt`), as every expression's check reads it (body-checker.ts `expression`): decided
 * before checking from what the value is known to take.
 *
 * A member that is a union again, a recursive one's once unfolded, gives the member of it the value
 * is built as, at any depth, so a value goes into a union inside a union through each in turn.
 *
 * A value with a type of its own goes into the union as fitting puts it, its parts converted where
 * they need (§3.5): `[42]` where a `Tree | String` is expected is an `Array<Int>` converted.
 */

import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { AcceptedPart, BodyContext } from '../../../contexts/body-context.ts';
import { memberBuilt } from '../../../types/fitting/expected.ts';
import { unfolded } from '../../../types/type/computed-types.ts';
import type { Type } from '../../../types/type/index.ts';
import { openAcceptsOf } from '../expressions.ts';

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
      openAccepts: () => openAcceptsOf(context, node),
    }),
  );
  return member !== expected && member.kind === 'union'
    ? builtMember(context, node, member, part)
    : member;
}
