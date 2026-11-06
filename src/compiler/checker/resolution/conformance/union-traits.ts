/**
 * A union and the traits it meets through its members (§6). A union has no module and no functions
 * of its own, so it meets a trait through functions declared for it, as a shape does
 * (conformance.ts), or else through its members: when every member meets the trait and the trait
 * could follow `any` (types/traits/object-safety.ts), its functions run the function of whichever
 * member a value is, as a value of `any` that trait would.
 *
 * - The trait is held as `any` takes it (`MembersRequirement.through`): `any Stringable`, an
 *   argument that is the union itself its trait's own `Self`. So the union and each member read it
 *   alike, and lowering finds each member's functions as it does for an `any` value's.
 * - A call on a union that no function takes whole calls the function of that name a trait visible
 *   at the call requires (choosing/candidates.ts), only one taking `Self` first. Nothing names the
 *   trait's arguments there, so a parameter with a default takes it, and one without is found from
 *   the call's arguments, as the function's own type parameters are (`Requirement.inferred`).
 *   Whether the union meets the trait is conformance's to say, where the call is chosen, or, for
 *   arguments found so, once they are (trait-calls.ts, ../applied-call.ts).
 */

import { unreachable } from '../../../../structures/unreachable.ts';
import {
  type FunctionDeclaration,
  type TraitDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { MembersRequirement } from '../../surface/resolved-call.ts';
import { sameType } from '../../types/identity/identity.ts';
import { substitute } from '../../types/parts/substitution.ts';
import {
  constraintOn,
  constraintSubstitution,
  type Requirement,
  requiredFunctions,
} from '../../types/traits/constraints.ts';
import { objectUnsafety } from '../../types/traits/object-safety.ts';
import type { AnyType, Constraint, ParameterKey, Type, UnionType } from '../../types/type/index.ts';
import type { TypeRules } from '../../types/type/type-rules.ts';
import { typeText } from '../../types/type/type-text.ts';
import { parameterType } from '../../types/written/resolve-type.ts';
import { defaultArgument } from '../../types/written/type-arguments.ts';

/** A call through a union's trait, as a candidate: the required function, and how it is reached. */
export interface MembersCall {
  readonly declaration: FunctionDeclaration;
  readonly requirement: Requirement & { readonly origin: MembersRequirement };
}

/** A union meeting a required function of `through`'s trait through its members. */
export interface MembersMeeting {
  readonly union: UnionType;
  readonly through: AnyType;
  readonly declaration: FunctionDeclaration;
}

/** The one constraint of `through`, a trait as `any` takes it, as `type` meets it. */
export function traitMetBy(through: AnyType, type: Type, rules: TypeRules): Constraint {
  const [written] = through.constraints;
  return written === undefined
    ? unreachable('A trait called through members is one constraint.')
    : constraintOn(written, type, rules);
}

/**
 * Why `union` can't meet `through`'s trait through its members, needing `declaration` declared
 * for it whole instead, in words a diagnostic finishes ("it needs …"): the trait can't follow `any`
 * (§3.10), or a member doesn't meet it, as `memberMeets` says; undefined when it can.
 */
export function membersShortfall(
  checker: CheckerContext,
  { union, through, declaration }: MembersMeeting,
  memberMeets: (member: Type, constraint: Constraint) => boolean,
): string | undefined {
  const [written] = through.constraints;
  if (written === undefined) {
    return unreachable('A trait called through members is one constraint.');
  }
  const trait = written.trait.name.text;
  const unsafety = objectUnsafety(checker, written);
  if (unsafety !== undefined) {
    const name = declaration.name.text;
    return `'${name}' declared for it, as ${trait} can't be met through its members: ${unsafety}`;
  }
  const unmet = union.members.find(
    (member) => !memberMeets(member, traitMetBy(through, member, checker.typeRules)),
  );
  return unmet === undefined ? undefined : `its member ${typeText(unmet)} to satisfy ${trait} too`;
}

/**
 * The call of `declaration`, the `member`-th function of `through`'s trait, on `union`'s members;
 * `inferred` are the trait's parameters `through` names as themselves, which the call finds.
 */
export function membersCall(
  rules: TypeRules,
  union: UnionType,
  through: AnyType,
  call: {
    readonly declaration: FunctionDeclaration;
    readonly member: number;
    readonly inferred?: readonly TypeParameter[];
  },
): MembersCall {
  const { declaration, member, inferred = [] } = call;
  const origin: MembersRequirement = { kind: 'members', on: union, through, member };
  const substitution = constraintSubstitution(traitMetBy(through, union, rules), union);
  return {
    declaration,
    requirement: {
      declaration,
      substitution,
      origin,
      inferred: inferred.length === 0 ? undefined : inferred,
    },
  };
}

/** The union requirement a candidate calls through members; undefined for any other candidate. */
export function membersRequirementOf(candidate: {
  readonly requirement?: Requirement | undefined;
}): MembersRequirement | undefined {
  const origin = candidate.requirement?.origin;
  return origin?.kind === 'members' ? origin : undefined;
}

/**
 * The calls of `name` on `union` through `trait`: each function of that name it requires taking
 * `Self` first.
 */
export function traitCallsOn(
  checker: CheckerContext,
  union: UnionType,
  trait: TraitDeclaration,
  name: string,
): readonly MembersCall[] {
  const { written, inferred } = traitAsCalled(checker, trait);
  const through: AnyType = { kind: 'any', constraints: [written] };
  return requiredFunctions(trait).flatMap((declaration, member) =>
    declaration.name.text === name && takesSelfFirst(checker, written, declaration)
      ? [membersCall(checker.typeRules, union, through, { declaration, member, inferred })]
      : [],
  );
}

/**
 * `trait` as a call on a union names it, as `any` takes it, with no type arguments written: each
 * parameter with a default takes it, and each without stands for itself, `inferred` by the call.
 */
function traitAsCalled(
  checker: CheckerContext,
  trait: TraitDeclaration,
): { readonly written: Constraint; readonly inferred: readonly TypeParameter[] } {
  const substitution = new Map<ParameterKey, Type>([[trait, parameterType(trait)]]);
  const typeArguments: Type[] = [];
  const inferred: TypeParameter[] = [];
  for (const parameter of typeParametersOf(trait.typeParameters)) {
    if (parameter.defaultType === undefined) {
      inferred.push(parameter);
    }
    const argument =
      parameter.defaultType === undefined
        ? parameterType(parameter)
        : defaultArgument(checker, trait, parameter, substitution);
    substitution.set(parameter, argument);
    typeArguments.push(argument);
  }
  return { written: { trait, arguments: typeArguments }, inferred };
}

/**
 * Whether `declaration`, required by `written`'s trait, written as after `any`, is called on a
 * value: `Self` is its first parameter.
 */
function takesSelfFirst(
  checker: CheckerContext,
  written: Constraint,
  declaration: FunctionDeclaration,
): boolean {
  const [receiver] = checker.parametersOf(declaration);
  if (receiver === undefined || declaration.owner !== undefined) {
    return false;
  }
  const self = parameterType(written.trait);
  return sameType(
    substitute(receiver.type, constraintSubstitution(written, self), checker.typeRules),
    self,
  );
}
