/**
 * Member bounds on associated types (§8.2): `type Mode in Persistence` makes `T.Mode`, for a `T`
 * not known yet, stand for one member of that union, as a member parameter does (§8.1), so it may
 * be a requirement's mark (`Self.Mode fn`) and a member parameter's argument. Where several of
 * `T`'s traits bound it, it is one member of each, so of the members they share.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { substitute } from '../parts/substitution.ts';
import type { AssociatedOfType } from '../type/computed-types.ts';
import type { Type } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { hasMember, unionOf } from '../unions/unions.ts';
import { constraintSubstitution } from './constraints.ts';
import { requirementsDeclaring } from './known-constraints.ts';

/** The union `type` stands for one member of; undefined when no requirement bounds it so. */
export function associatedMemberUnion(
  checker: CheckerContext,
  type: AssociatedOfType,
): Type | undefined {
  const unions = requirementsDeclaring(checker, type.of, type.name).flatMap(
    ({ constraint, requirement }) => {
      const { memberOf } = checker.associatedBoundsOf(requirement);
      return memberOf === undefined
        ? []
        : [substitute(memberOf, constraintSubstitution(constraint, type.of), checker.typeRules)];
    },
  );
  const [first, ...others] = unions;
  if (first === undefined || others.length === 0) {
    return first;
  }
  const shared = membersOf(first).filter((member) =>
    others.every((other) => hasMember(other, member)),
  );
  return unionOf(shared, checker.typeRules);
}
