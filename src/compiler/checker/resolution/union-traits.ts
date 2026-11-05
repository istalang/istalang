/**
 * A union and the traits it meets through its members (§6). A union has no module and no functions
 * of its own, so it meets a trait through functions declared for it, as a shape does
 * (conformance.ts), or else through its members: when every member meets the trait and the trait
 * could follow `any` (traits/object-safety.ts), its functions run the function of whichever member
 * a value is, as a value of `any` that trait would.
 *
 * - The trait is held as `any` takes it (`MembersRequirement.through`): `any Stringable`, an
 *   argument that is the union itself its trait's own `Self`. So the union and each member read it
 *   alike, and lowering finds each member's functions as it does for an `any` value's.
 * - A call on a union that no function takes whole calls the function of that name a trait
 *   visible at the call requires (candidates.ts): only a trait whose parameters all have defaults
 *   is named with nothing written, and only a function taking `Self` first is called on a value.
 *   Whether the union meets the trait is conformance's to say, where the call is chosen
 *   (applied-call.ts).
 */

import { unreachable } from '../../../structures/unreachable.ts';
import {
  type FunctionDeclaration,
  type TraitDeclaration,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import type { MembersRequirement } from '../resolved-call.ts';
import {
  constraintOn,
  constraintSubstitution,
  type Requirement,
  requiredFunctions,
} from '../traits/constraints.ts';
import { objectUnsafety } from '../traits/object-safety.ts';
import { sameType } from '../types/identity.ts';
import { defaultArgument, parameterType } from '../types/resolve-type.ts';
import { substitute } from '../types/substitution.ts';
import type { AnyType, Constraint, ParameterKey, Type, UnionType } from '../types/type.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { typeText } from '../types/type-text.ts';

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

/** The call of `declaration`, the `member`-th function of `through`'s trait, on `union`'s members. */
export function membersCall(
  rules: TypeRules,
  union: UnionType,
  through: AnyType,
  { declaration, member }: { readonly declaration: FunctionDeclaration; readonly member: number },
): MembersCall {
  const origin: MembersRequirement = { kind: 'members', on: union, through, member };
  const substitution = constraintSubstitution(traitMetBy(through, union, rules), union);
  return { declaration, requirement: { declaration, substitution, origin } };
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
 * `Self` first, when every parameter of the trait has a default; none otherwise.
 */
export function traitCallsOn(
  checker: CheckerContext,
  union: UnionType,
  trait: TraitDeclaration,
  name: string,
): readonly MembersCall[] {
  const written = traitNamedAlone(checker, trait);
  if (written === undefined) {
    return [];
  }
  const through: AnyType = { kind: 'any', constraints: [written] };
  return requiredFunctions(trait).flatMap((declaration, member) =>
    declaration.name.text === name && takesSelfFirst(checker, written, declaration)
      ? [membersCall(checker.typeRules, union, through, { declaration, member })]
      : [],
  );
}

/**
 * `trait` named with no type arguments written, as `any` takes it, every parameter its default;
 * undefined when one has no default, since nothing at a call says what it is.
 */
function traitNamedAlone(checker: CheckerContext, trait: TraitDeclaration): Constraint | undefined {
  const substitution = new Map<ParameterKey, Type>([[trait, parameterType(trait)]]);
  const typeArguments: Type[] = [];
  for (const parameter of typeParametersOf(trait.typeParameters)) {
    if (parameter.defaultType === undefined) {
      return undefined;
    }
    const argument = defaultArgument(checker, trait, parameter, substitution);
    substitution.set(parameter, argument);
    typeArguments.push(argument);
  }
  return { trait, arguments: typeArguments };
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
