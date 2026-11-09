/**
 * The instantiation of a trait a type meets where an `any` type's constraint asks for another
 * (§3.10): a value of `IntSource`, which meets `Source<Int>`, goes into an `any Source<Int?>` as
 * itself, called through `Source<Int>`'s witnesses, each call converting what it gives and takes
 * (lowering/synthesized/trait-objects.ts).
 *
 * - A type meeting the constraint itself meets it so: a type meets a trait with the same functions
 *   wherever it is met (coherence), whatever converts around it.
 * - Else instantiations it may meet are proposed, and each must then be met as any constraint is
 *   (../conformance.ts), which has the last word: those it meets by what it is
 *   (types/traits/known-constraints.ts: an `any` type's, a type parameter's, a computed type's),
 *   and those its witness candidates make. A candidate is matched against each requirement as a
 *   witness is chosen (../declared-witness.ts), a by-value literal as its base and its trailing
 *   parameters left to their defaults; the trait's invariant parameters, its receiver's type among
 *   them (`C = Self`), are the constraint's own, and one a generic candidate leaves to its own type
 *   parameters is left open by it. Every combination agreeing across the requirements and required
 *   fields, a parameter none finds taken from the constraint, is proposed.
 * - Of those that fit the constraint as the trait's variance says (types/variance/variance.ts), the
 *   closest is the one: the one every other fits. Several, none closer, are refused at a conversion
 *   showing them, as converting into several members of a union is (§2). Where none can be seen, a
 *   value an `any` type took from another, the first proposed stands, its functions declared first,
 *   as C# picks among interfaces a class implements.
 * - With no constraint sought, each of the trait's parameters is found as a varying one is, and a
 *   call through `any` passes nothing where it mentions one: what a type may meet whatever it is
 *   converted into, which inference relates through. A type holding type parameters, inference's
 *   variables among them, can't be asked whether it meets one until they are known, so what its
 *   witnesses' signatures propose stands; a nominal one's are its declaration's own instance's,
 *   the receiver binding exactly (§3.10), so one search per declaration serves them all.
 */

import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import type { TraitDeclaration, TypeParameter } from '../../../../syntax/declarations/index.ts';
import { typeParametersOf } from '../../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { searchSite } from '../../../contexts/use-site.ts';
import { constraintFits } from '../../../types/fitting/fit/index.ts';
import type {
  MetInstantiation,
  ProposedInstantiation,
} from '../../../types/fitting/met-instantiation.ts';
import { sameConstraint, sameType } from '../../../types/identity/identity.ts';
import {
  type Substitution,
  substitute,
  substituteConstraint,
  substitutionFor,
} from '../../../types/parts/substitution.ts';
import { parametersIn } from '../../../types/parts/type-parts.ts';
import {
  declaredFieldType,
  requiredFields,
  requiredFunctions,
} from '../../../types/traits/constraints.ts';
import { knownConstraints } from '../../../types/traits/known-constraints.ts';
import { fieldOf } from '../../../types/traits/known-fields.ts';
import {
  type Constraint,
  nominalType,
  type ParameterKey,
  type Type,
} from '../../../types/type/index.ts';
import { constraintText, typeText } from '../../../types/type/type-text.ts';
import type { Variance } from '../../../types/variance/lattice.ts';
import { parameterType } from '../../../types/written/resolve-type.ts';
import { defaultArgument } from '../../../types/written/type-arguments.ts';
import { signatureOf } from '../../choosing/choice.ts';
import { meets } from '../conformance.ts';
import { agreed, type Binding, bindingsOf, candidateBindings } from './witness-bindings.ts';

/**
 * The instantiation of `constraint`'s trait `found` meets in its place (the banner), searched: the
 * program keeps each answer (`Fitting.metInstantiation`), which every other reader asks.
 */
export function searchMetInstantiation(
  checker: CheckerContext,
  found: Type,
  constraint: Constraint,
): MetInstantiation {
  const fitting = fittingInstantiations(checker, found, constraint);
  const [closest, ...others] = fitting.filter((candidate) =>
    fitting.every((other) => constraintFits(other, candidate, checker.fitting)),
  );
  if (closest !== undefined && others.length === 0) {
    return { kind: 'met', constraint: closest };
  }
  return fitting.length === 0 ? { kind: 'none' } : { kind: 'several', fitting };
}

/**
 * The instantiation a value of `found`, inside an `any` type, is called through for `constraint`:
 * `Fitting.metInstantiation`'s, or, where none is closest, the first proposed (the banner). A value an
 * `any` type took from another met that one's constraint, which stands for this one, so one fits.
 */
export function memberConstraint(
  checker: CheckerContext,
  found: Type,
  constraint: Constraint,
): Constraint {
  const met = checker.fitting.metInstantiation(found, constraint);
  switch (met.kind) {
    case 'met':
      return met.constraint;
    case 'several':
      return met.fitting[0] ?? unreachable('Several instantiations are some.');
    default:
      return unreachable(
        `${typeText(found)} went into an any ${constraintText(constraint)} without meeting it.`,
      );
  }
}

/** The instantiations `found` meets that fit `constraint`, the constraint itself alone when met. */
function fittingInstantiations(
  checker: CheckerContext,
  found: Type,
  constraint: Constraint,
): readonly Constraint[] {
  const site = searchSite(checker);
  if (meets(site, found, constraint)) {
    return [constraint];
  }
  const variances = checker.fitting.varianceOf(constraint.trait);
  if (variances.every((each) => each === 'invariant')) {
    return [];
  }
  const sought = { trait: constraint.trait, arguments: constraint.arguments, variances, free: [] };
  return proposedFor(checker, found, sought).flatMap(({ constraint: each }) =>
    constraintFits(each, constraint, checker.fitting) && meets(site, found, each) ? [each] : [],
  );
}

/**
 * The instantiations of `trait` a value of `found` may meet, each of its parameters found by what
 * the type is or by its witnesses' signatures, none sought (the banner): what inference relates a
 * value through where an `any` type is expected (types/inference/relate.ts). Of a type holding no
 * type parameter, those it meets, kept (`kept`); of a nominal type holding some, inference's
 * variables among them, those its declaration's own instance is proposed, kept alike, its type
 * arguments put in: whether it meets one is judged once they are known, a witness's own constraints
 * and the instantiation it is declared for among what decides it.
 */
export function proposedInstantiations(
  checker: CheckerContext,
  { found, trait }: { readonly found: Type; readonly trait: TraitDeclaration },
  kept: (type: Type) => readonly ProposedInstantiation[],
): readonly ProposedInstantiation[] {
  if (parametersIn(found).length === 0) {
    return kept(found);
  }
  if (found.kind !== 'nominal') {
    return instantiationsOf(checker, found, trait);
  }
  const { typeParameters } = found.entity.declaration;
  const own = nominalType(found.entity, typeParametersOf(typeParameters).map(parameterType));
  const given = substitutionFor(typeParameters, found.arguments);
  const rules = checker.typeRules;
  return kept(own).map(({ self, constraint }) => ({
    self: substitute(self, given, rules),
    constraint: substituteConstraint(constraint, given, rules),
  }));
}

/**
 * The instantiations of `trait` that `found` itself may meet, none sought (`proposedInstantiations`):
 * those it meets when it holds no type parameter, else every one proposed.
 */
export function instantiationsOf(
  checker: CheckerContext,
  found: Type,
  trait: TraitDeclaration,
): readonly ProposedInstantiation[] {
  const parameters = typeParametersOf(trait.typeParameters);
  const free = parametersIn(found);
  const proposed = proposedFor(checker, found, {
    trait,
    // A parameter standing for `Self` unless written (`C = Self`) is sought as the type itself.
    arguments: parameters.map((parameter) =>
      defaultsToSelf(checker, trait, parameter) ? found : undefined,
    ),
    variances: checker.fitting.varianceOf(trait),
    free,
  });
  if (free.length > 0) {
    return proposed;
  }
  const site = searchSite(checker);
  return proposed.filter(({ constraint }) => meets(site, found, constraint));
}

/**
 * The instantiations of a trait `found` may meet, met or not, once each: those it meets by what it
 * is, then those its witness candidates make.
 */
function proposedFor(
  checker: CheckerContext,
  found: Type,
  sought: Sought,
): readonly ProposedInstantiation[] {
  const proposed = [
    ...knownConstraints(checker, found)
      .filter((each) => each.trait === sought.trait)
      .map((constraint) => ({ self: found, constraint })),
    ...instantiationsMet(checker, found, sought),
  ];
  const same = (first: ProposedInstantiation, second: ProposedInstantiation) =>
    sameType(first.self, second.self) && sameConstraint(first.constraint, second.constraint);
  return proposed.filter(
    (each, index) => proposed.findIndex((other) => same(other, each)) === index,
  );
}

/**
 * A trait whose instantiations are being found, with its parameters' variances and the argument
 * sought for each, a call through `any` passing it; undefined where none is, the parameter then
 * found as a varying one is. The type's own `free` parameters may be found too, where a witness is
 * declared for one instantiation of it, which then meets the trait.
 */
interface Sought {
  readonly trait: TraitDeclaration;
  readonly arguments: readonly (Type | undefined)[];
  readonly variances: readonly Variance[];
  readonly free: readonly ParameterKey[];
}

/**
 * The instantiations of the trait `found`'s witness candidates make, met or not: every combination
 * of what each requirement's candidates and each required field find, agreeing. One leaving a
 * parameter neither found nor sought is none.
 */
function instantiationsMet(
  checker: CheckerContext,
  found: Type,
  sought: Sought,
): readonly ProposedInstantiation[] {
  const { trait, variances, free } = sought;
  const parameters = typeParametersOf(trait.typeParameters);
  const given = (index: number) => sought.arguments[index];
  const varies = (index: number) =>
    given(index) === undefined || (variances[index] ?? 'invariant') !== 'invariant';
  const open = parameters.filter((_, index) => varies(index));
  const self: Substitution = new Map<ParameterKey, Type>([
    [trait, found],
    ...parameters.flatMap((parameter, index) => {
      const argument = given(index);
      return varies(index) || argument === undefined ? [] : [[parameter, argument] as const];
    }),
  ]);
  // Where a call through `any` is made: every parameter sought at its argument.
  const called = new Map<ParameterKey, Type>([
    ...parameters.flatMap((parameter, index) => {
      const argument = given(index);
      return argument === undefined ? [] : [[parameter, argument] as const];
    }),
    [trait, found],
  ]);
  const unsought = parameters.filter((_, index) => given(index) === undefined);
  const findings = [
    ...requiredFunctions(trait).map((required) =>
      candidateBindings(checker, found, {
        required: signatureOf(checker, required, self),
        called: signatureOf(checker, required, called),
        open,
        unsought,
        free,
      }),
    ),
    ...requiredFields(trait).map((field) => {
      const declared = substitute(
        declaredFieldType(checker, trait, field),
        self,
        checker.typeRules,
      );
      const own = fieldOf(checker, found, field.name.text);
      const pairs = own === undefined ? undefined : [[declared, own.member.type] as const];
      return pairs === undefined
        ? []
        : bindingsOf(checker, { reported: open, unknown: open }, pairs);
    }),
  ];
  const combined = findings.reduce<readonly Binding[]>(
    (sofar, options) =>
      sofar.flatMap((binding) => options.flatMap((option) => agreed(binding, option) ?? [])),
    [new Map()],
  );
  return combined.flatMap((binding) => proposalOf(checker, found, binding, sought));
}

/**
 * What `binding` proposes: the trait at what it found, or else was sought, met by `found` as the
 * type's own parameters it found make it; none where a parameter is neither found nor sought.
 */
function proposalOf(
  checker: CheckerContext,
  found: Type,
  binding: Binding,
  { trait, arguments: sought, free }: Sought,
): readonly ProposedInstantiation[] {
  const instantiated = typeParametersOf(trait.typeParameters).map(
    (parameter, index) => binding.get(parameter) ?? sought[index],
  );
  if (!instantiated.every((each) => each !== undefined)) {
    return [];
  }
  const receiver = new Map(free.flatMap((key) => receiverEntry(binding, key)));
  const meeting = receiver.size === 0 ? found : substitute(found, receiver, checker.typeRules);
  return [{ self: meeting, constraint: { trait, arguments: instantiated } }];
}

/** What `binding` found the type's own parameter `key` to be, as an entry; none if nothing. */
function receiverEntry(
  binding: Binding,
  key: ParameterKey,
): readonly (readonly [ParameterKey, Type])[] {
  const type = binding.get(key);
  return type === undefined ? [] : [[key, type]];
}

/** Whether `parameter` of `trait` defaults to the trait's own `Self` (`C = Self`). */
function defaultsToSelf(
  checker: CheckerContext,
  trait: TraitDeclaration,
  parameter: TypeParameter,
): boolean {
  const written = defaultArgument(checker, trait, parameter, new Map());
  return written.kind === 'parameter' && written.declaration === trait;
}
