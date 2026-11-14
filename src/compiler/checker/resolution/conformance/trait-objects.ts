/**
 * How a value becomes an `any` type's (§3.10): a type converts into `any A & B` when it meets each
 * constraint, its own type standing for the constraint's `Self`, or an instantiation of its trait
 * that the trait's variance lets stand for it (met-instantiations/index.ts), and an `any` type
 * converts into another whose constraints its own stand for so. A union converts when each of its
 * members does (§6), since a value inside an `any` type is a value of its own type, never of a
 * union: one converts as whichever member it is.
 *
 * Meeting is decided once per type and constraint, wherever it is asked (coherence, §3.10), so a
 * conversion records no witnesses: lowering finds them again for each type a value converts from,
 * through the instantiation it meets, with the types what a call takes and gives converts between
 * (`traitObjectsOf`).
 *
 * Whether an `any` member of a union takes another member whole (§2), the union's normal form, is
 * decided by meeting exactly: types are normalized while they are resolved, and a trait's variance
 * is derived from the types it resolves. A member meeting it only through variance stays beside it,
 * and a value of it goes in as its own type.
 */

import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../../syntax/declarations/index.ts';
import type { MemberConversion, TraitObjects } from '../../check.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { searchSite, type UseSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { sameConstraint } from '../../types/identity/identity.ts';
import {
  constraintOn,
  type Substitution,
  substitute,
  substitutionFor,
} from '../../types/parts/substitution.ts';
import {
  constraintSubstitution,
  requiredFieldType,
  requirementType,
} from '../../types/traits/constraints.ts';
import type { AnyType, Constraint, FunctionType, Type } from '../../types/type/index.ts';
import { constraintText, typeText } from '../../types/type/type-text.ts';
import { meets, witnessesFor } from './conformance.ts';
import { memberConstraint } from './met-instantiations/index.ts';

/** Whether a value of `found` converts into `target` (§3.10). */
export function meetsAny(checker: CheckerContext, found: Type, target: AnyType): boolean {
  return meetsEach(
    checker,
    { found, target },
    (type, constraint) => checker.fitting.metInstantiation(type, constraint).kind === 'met',
  );
}

/** Whether `target`, an `any` member of a union, takes `found`, another member, whole (§2). */
export function absorbs(checker: CheckerContext, found: Type, target: AnyType): boolean {
  const site = searchSite(checker);
  return meetsEach(checker, { found, target }, (type, constraint) => meets(site, type, constraint));
}

/** Whether `found`, or each member of it, meets every constraint of `target` as `meetsOne` says. */
function meetsEach(
  checker: CheckerContext,
  { found, target }: { readonly found: Type; readonly target: AnyType },
  meetsOne: (type: Type, constraint: Constraint) => boolean,
): boolean {
  if (found.kind === 'union') {
    return found.members.every((member) => meetsEach(checker, { found: member, target }, meetsOne));
  }
  return target.constraints.every((constraint) =>
    meetsOne(found, constraintOn(constraint, found, checker.typeRules)),
  );
}

/**
 * Reports at `site` the first constraint of `target` that `found`, or a member of it, doesn't meet;
 * whether there was one. An `any` type meeting none is left to read as the misfit it is, a type of
 * traits it doesn't have; meeting several, none closer, it is as ambiguous as any type.
 */
export function reportUnmet(site: UseSite, found: Type, target: AnyType): boolean {
  if (found.kind === 'union') {
    return found.members.some((member) => reportUnmet(site, member, target));
  }
  return target.constraints.some((constraint) => {
    const own = constraintOn(constraint, found, site.checker.typeRules);
    const met = site.checker.fitting.metInstantiation(found, own);
    switch (met.kind) {
      case 'met':
        return false;
      case 'several':
        site.report((at) =>
          checkerDiagnostics.severalInstantiations(
            at,
            typeText(found),
            met.fitting.map(constraintText),
            constraintText(own),
          ),
        );
        return true;
      default:
        return found.kind !== 'any' && !meets(site, found, own);
    }
  });
}

/** How `checker`'s program calls, reads and takes apart values of `any` types (`TraitObjects`). */
export function traitObjectsOf(checker: CheckerContext): TraitObjects {
  return {
    memberWitnesses: (type, constraint, member) => {
      if (!meetsMember(checker, { type, constraint, member })) {
        return;
      }
      const { met } = memberConstraints(checker, { type, constraint, member });
      return witnessesFor(searchSite(checker), member, met);
    },
    memberSignatures: (type, constraint, member, call) => {
      const signature = requirementType(checker, call.required);
      return converting(memberConstraints(checker, { type, constraint, member }), (each) =>
        functionTypeOf(
          substitute(signature, requiredSubstitution(each, member, call), checker.typeRules),
        ),
      );
    },
    callSubstitution: (type, constraint, on, call) =>
      requiredSubstitution(
        type.constraints[constraint] ??
          unreachable(`${typeText(type)} has no constraint ${constraint}.`),
        on,
        call,
      ),
    witnessesMeeting: (type, constraint) => witnessesFor(searchSite(checker), type, constraint),
    memberFieldTypes: (type, constraint, member, field) =>
      converting(memberConstraints(checker, { type, constraint, member }), (each) =>
        requiredFieldType(checker, each, field, member),
      ),
    mayHold: (type, target) =>
      meetsEach(
        checker,
        { found: type, target },
        (found, constraint) => checker.fitting.metInstantiation(found, constraint).kind !== 'none',
      ),
  };
}

/**
 * How a call of `required`, with its own `typeArguments`, through `met` on a value of `self` maps
 * the required function's types: the trait's parameters and `Self`, then its own.
 */
function requiredSubstitution(
  met: Constraint,
  self: Type,
  {
    required,
    typeArguments,
  }: { readonly required: FunctionDeclaration; readonly typeArguments: readonly Type[] },
): Substitution {
  return new Map([
    ...constraintSubstitution(met, self),
    ...substitutionFor(typeParametersOf(required.typeParameters), typeArguments),
  ]);
}

/** A value of `member` inside `type`, called through its `constraint`-th constraint. */
interface Member {
  readonly type: AnyType;
  readonly constraint: number;
  readonly member: Type;
}

/**
 * The constraint a call through `type` on a value of `member` is made at (`called`), its
 * `constraint`-th with `member` as its `Self`, and the instantiation `member` meets in its place.
 */
function memberConstraints(
  checker: CheckerContext,
  { type, constraint, member }: Member,
): MemberConversion<Constraint> {
  const own =
    type.constraints[constraint] ?? unreachable(`${typeText(type)} has no such constraint.`);
  const called = constraintOn(own, member, checker.typeRules);
  return { called, met: memberConstraint(checker, member, called) };
}

/** Whether `member` meets `type`'s `constraint`-th constraint: not where a mistake put it in. */
function meetsMember(checker: CheckerContext, { type, constraint, member }: Member): boolean {
  const own = type.constraints[constraint];
  return (
    own !== undefined &&
    checker.fitting.metInstantiation(member, constraintOn(own, member, checker.typeRules)).kind !==
      'none'
  );
}

/** What `shape` makes of each of `constraints`; undefined where the member meets the one called. */
function converting<Shape>(
  constraints: MemberConversion<Constraint>,
  shape: (constraint: Constraint) => Shape,
): MemberConversion<Shape> | undefined {
  const { called, met } = constraints;
  return sameConstraint(called, met) ? undefined : { called: shape(called), met: shape(met) };
}

/** `type`, a function type a substitution kept one. */
function functionTypeOf(type: Type): FunctionType {
  return type.kind === 'function'
    ? type
    : unreachable(`A requirement substituted is a function type, not ${typeText(type)}.`);
}
