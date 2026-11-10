/**
 * Whether a type may stand for a member parameter (§3.5): `S in U` stands for exactly one member of
 * `U`, so its argument, to a call or to a type, written or inferred, must be one: a member, or a
 * member parameter whose own union's members all are, which each instantiation makes one of them.
 * Never several, nor a type outside `U`, nor a type parameter that could be any type. Inference
 * fills one only so (types/inference/infer.ts `#filling`), and an argument is checked here; both
 * read the rule `isOneMember` states.
 */

import { isKindParameter } from '../../../syntax/declarations/function-kinds.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { UseSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import { isOneKind, kindHolderName } from '../type/function-kinds.ts';
import type { Type } from '../type/index.ts';
import { typeText } from '../type/type-text.ts';
import { hasMember, membersOf } from '../unions/unions.ts';
import type { Fitting } from './fit/index.ts';

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
  const { checker } = site;
  const written = checker.memberUnionOf(parameter);
  if (argument.kind === 'error') {
    return true;
  }
  if (isKindParameter(parameter)) {
    return standsForKind(site, parameter, argument);
  }
  if (written === undefined) {
    return true;
  }
  const union = substitute(written, substitution, checker.typeRules);
  if (isOneMember(union, argument, checker.fitting.memberUnionOf)) {
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

/**
 * Whether `argument` may stand for the kind parameter `parameter` (§3.3): any kind, or one of the
 * two where `parameter` stands for one (`K in Persistence`, an implicit one a future reads);
 * reported at `site` when it can't, as code that may run in either calling what needs one, which
 * a mark on that code mends.
 */
function standsForKind(site: UseSite, parameter: TypeParameter, argument: Type): boolean {
  if (parameter.memberOf === undefined || isOneKind(argument)) {
    return true;
  }
  site.report((at) =>
    checkerDiagnostics.oneKindOfEither(at, kindHolderName(site.checker, parameter)),
  );
  return false;
}
