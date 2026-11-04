/**
 * Whether a type argument may stand for a member parameter (§3.5): `S in U` stands for exactly one
 * member of `U`, so an argument written for it, to a call or to a type, must be one, never several
 * nor a type outside `U`. Inference fills one only so (inference/infer.ts); a written argument is
 * checked here, the one rule calls and types share. An argument naming a type parameter is checked
 * where that parameter is given its own.
 */

import type { TypeParameter } from '../../syntax/declarations.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { UseSite } from '../use-site.ts';
import { sameType } from './identity.ts';
import { type Substitution, substitute } from './substitution.ts';
import type { Type } from './type.ts';
import { parametersIn } from './type-parts.ts';
import { typeText } from './type-text.ts';
import { membersOf } from './unions.ts';

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
  if (written === undefined || argument.kind === 'error' || parametersIn(argument).length > 0) {
    return true;
  }
  const union = substitute(written, substitution);
  if (membersOf(union).some((member) => sameType(member, argument))) {
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
