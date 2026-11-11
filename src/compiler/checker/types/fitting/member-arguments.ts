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
import { isSimpleMark, kindHolderName, standsForOneKind } from '../type/function-kinds.ts';
import type { Type } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { typeText } from '../type/type-text.ts';
import { hasMember } from '../unions/unions.ts';
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
  const own = memberUnionOf(type);
  return (
    own !== undefined && membersOf(own).every((member) => isOneMember(union, member, memberUnionOf))
  );
}

/**
 * Whether `argument` may stand for `parameter`, its union read with the arguments `substitution`
 * gives the parameters before it; reports at `site` when it can't. Any other parameter takes it.
 * A mark parameter is a member parameter as any (proposal 8, Rule 3): `K in "live"` takes no
 * `"ista"`. The bottom given where one of the two kinds is needed is simple code calling what needs
 * a kind, which a mark on that code mends, and is told so.
 */
export function standsForMember(
  site: UseSite,
  parameter: TypeParameter,
  argument: Type,
  substitution: Substitution,
): boolean {
  const { checker } = site;
  const written = checker.memberUnionOf(parameter);
  if (argument.kind === 'error' || written === undefined) {
    return true;
  }
  const union = substitute(written, substitution, checker.typeRules);
  if (isOneMember(union, argument, checker.fitting.memberUnionOf)) {
    return true;
  }
  site.report((at) =>
    standsForOneKind(checker, parameter) && isSimpleMark(argument)
      ? checkerDiagnostics.oneKindOfEither(at, kindHolderName(checker, parameter))
      : checkerDiagnostics.notMemberArgument(
          at,
          parameter.name.text,
          typeText(union),
          typeText(argument),
        ),
  );
  return false;
}
