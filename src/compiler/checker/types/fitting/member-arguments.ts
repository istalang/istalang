/**
 * Whether a type may stand for a member parameter (§3.5): `S in U` stands for exactly one member of
 * `U`, so its argument, to a call or to a type, written or inferred, must be one: a member, or a
 * member parameter whose own union's members all are, which each instantiation makes one of them.
 * Never several, nor a type outside `U`, nor a type parameter that could be any type. Inference
 * fills one only so (types/inference/infer.ts `#filling`), and an argument is checked here; both
 * read the rule `isOneMember` states.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { UseSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import type { Type } from '../type/index.ts';
import { typeText } from '../type/type-text.ts';
import { hasMember, membersOf } from '../unions/unions.ts';
import type { Fitting } from './fit.ts';

/** Whether `type` stands for one member of `union`, as a member parameter's argument must. */
export function isOneMember(
  union: Type,
  type: Type,
  memberUnionOf: Fitting['memberUnionOf'],
): boolean {
  if (hasMember(union, type)) {
    return true;
  }
  const own = type.kind === 'parameter' ? memberUnionOf(type) : undefined;
  return (
    own !== undefined && membersOf(own).every((member) => isOneMember(union, member, memberUnionOf))
  );
}

/**
 * Whether `argument` may stand for `parameter`, its union read with the arguments `substitution`
 * gives the parameters before it; reports at `site` when it can't. Any other parameter takes it.
 */
export function standsForMember(
  site: UseSite,
  parameter: TypeParameter,
  argument: Type,
  substitution: Substitution,
): boolean {
  const written = site.checker.memberUnionOf(parameter);
  if (written === undefined || argument.kind === 'error') {
    return true;
  }
  const union = substitute(written, substitution, site.checker.typeRules);
  if (isOneMember(union, argument, site.checker.fitting.memberUnionOf)) {
    return true;
  }
  site.report((at) =>
    checkerDiagnostics.notMemberArgument(
      at,
      parameter.name.text,
      typeText(union),
      typeText(argument),
    ),
  );
  return false;
}
