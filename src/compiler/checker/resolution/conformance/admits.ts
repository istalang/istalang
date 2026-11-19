/**
 * Which types a type parameter admits while its call is settled (types/inference/settle.ts, rule
 * 2): one member of its union (`in`, §8.1), meeting each of its constraints that names no other
 * type parameter, which settling can't judge before those are settled. Whether a type meets a
 * constraint is the caller's to say, within the search it is asked in (conformance.ts).
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { isOneMember } from '../../types/fitting/member-arguments.ts';
import type { Admits } from '../../types/inference/complete.ts';
import { substituteConstraint } from '../../types/parts/substitution.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import type { Constraint, Type } from '../../types/type/index.ts';

/** What a type parameter admits, `meets` saying whether a type meets a constraint. */
export function admitting(
  checker: Pick<CheckerContext, 'memberUnionOf' | 'constraintsOf' | 'fitting' | 'typeRules'>,
  meets: (type: Type, constraint: Constraint) => boolean,
): Admits {
  return (parameter, type) => {
    const union = checker.memberUnionOf(parameter);
    const own = new Map([[parameter, type]]);
    return (
      (union === undefined || isOneMember(union, type, checker.fitting.memberUnionOf)) &&
      checker.constraintsOf(parameter).every((constraint) => {
        const mapped = substituteConstraint(constraint, own, checker.typeRules);
        return (
          mapped.arguments.some((argument) => parametersIn(argument).length > 0) ||
          meets(type, mapped)
        );
      })
    );
  };
}
