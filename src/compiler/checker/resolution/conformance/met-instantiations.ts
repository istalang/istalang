/**
 * The instantiation of a trait a type meets where an `any` type's constraint asks for another
 * (§3.10): a value of `IntSource`, which meets `Source<Int>`, goes into an `any Source<Int?>` as
 * itself, called through `Source<Int>`'s witnesses, each call converting what it gives and takes
 * (lowering/synthesized/trait-objects.ts).
 *
 * - A type meeting the constraint itself meets it so: a type meets a trait with the same functions
 *   wherever it is met (coherence), whatever converts around it.
 * - Else instantiations it may meet are proposed, and each must then be met as any constraint is
 *   (conformance.ts), which has the last word: those it meets by what it is
 *   (types/traits/known-constraints.ts: an `any` type's, a type parameter's, a computed type's),
 *   and those its witness candidates make. A candidate is matched against each requirement as a
 *   witness is chosen (declared-witness.ts), a by-value literal as its base and its trailing
 *   parameters left to their defaults; the trait's invariant parameters, its receiver's type among
 *   them (`C = Self`), are the constraint's own, and one a generic candidate leaves to its own type
 *   parameters is left open by it. Every combination agreeing across the requirements and required
 *   fields, a parameter none finds taken from the constraint, is proposed.
 * - Of those that fit the constraint as the trait's variance says (types/variance/variance.ts), the
 *   closest is the one: the one every other fits. Several, none closer, are refused at a conversion
 *   showing them, as converting into several members of a union is (§2). Where none can be seen, a
 *   value an `any` type took from another, the first proposed stands, its functions declared first,
 *   as C# picks among interfaces a class implements.
 */

import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import { typeParametersOf } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { searchSite } from '../../contexts/use-site.ts';
import { constraintFits } from '../../types/fitting/fit/index.ts';
import { sameConstraint, sameType } from '../../types/identity/identity.ts';
import { Inference } from '../../types/inference/infer.ts';
import { type Substitution, substitute, substitutionFor } from '../../types/parts/substitution.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import {
  declaredFieldType,
  requiredFields,
  requiredFunctions,
} from '../../types/traits/constraints.ts';
import { knownConstraints } from '../../types/traits/known-constraints.ts';
import { fieldOf } from '../../types/traits/known-fields.ts';
import type { Constraint, ParameterKey, Type } from '../../types/type/index.ts';
import { constraintText, typeText } from '../../types/type/type-text.ts';
import { baseOf } from '../../types/unions/union-members.ts';
import type { Variance } from '../../types/variance/lattice.ts';
import type { SignatureSlot } from '../choosing/call-arguments.ts';
import { type Candidate, witnessCandidates } from '../choosing/candidates.ts';
import { type Signature, signatureOf } from '../choosing/choice.ts';
import { meets } from './conformance.ts';

/** What the trait's parameters were found to be, so far. */
type Binding = ReadonlyMap<TypeParameter, Type>;

/**
 * The instantiation of a constraint's trait a type meets in its place: one, none, or several that
 * fit, none closer than the others.
 */
export type MetInstantiation =
  | { readonly kind: 'met'; readonly constraint: Constraint }
  | { readonly kind: 'none' }
  | { readonly kind: 'several'; readonly fitting: readonly Constraint[] };

/** The instantiation of `constraint`'s trait `found` meets in its place (the banner). */
export function metInstantiation(
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
 * `metInstantiation`'s, or, where none is closest, the first proposed (the banner). A value an
 * `any` type took from another met that one's constraint, which stands for this one, so one fits.
 */
export function memberConstraint(
  checker: CheckerContext,
  found: Type,
  constraint: Constraint,
): Constraint {
  const met = metInstantiation(checker, found, constraint);
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
  const proposed = [
    ...knownConstraints(checker, found).filter((each) => each.trait === constraint.trait),
    ...instantiationsMet(checker, found, { constraint, variances }),
  ];
  return proposed.filter(
    (each, index) =>
      proposed.findIndex((other) => sameConstraint(other, each)) === index &&
      constraintFits(each, constraint, checker.fitting) &&
      meets(site, found, each),
  );
}

/** A constraint whose trait's instantiations are being found, with its parameters' variances. */
interface Sought {
  readonly constraint: Constraint;
  readonly variances: readonly Variance[];
}

/**
 * The instantiations of the trait `found`'s witness candidates make, met or not: every combination
 * of what each requirement's candidates and each required field find, agreeing.
 */
function instantiationsMet(
  checker: CheckerContext,
  found: Type,
  { constraint, variances }: Sought,
): readonly Constraint[] {
  const { trait } = constraint;
  const parameters = typeParametersOf(trait.typeParameters);
  const varies = (index: number) =>
    variances[index] !== undefined && variances[index] !== 'invariant';
  const open = parameters.filter((_, index) => varies(index));
  const self: Substitution = new Map<ParameterKey, Type>([
    [trait, found],
    ...parameters.flatMap((parameter, index) => {
      const given = constraint.arguments[index];
      return varies(index) || given === undefined ? [] : [[parameter, given] as const];
    }),
  ]);
  // Where a call through `any` is made: every parameter at the constraint's arguments.
  const called = new Map<ParameterKey, Type>([
    ...substitutionFor(trait.typeParameters, constraint.arguments),
    [trait, found],
  ]);
  const findings = [
    ...requiredFunctions(trait).map((required) =>
      candidateBindings(checker, found, {
        required: signatureOf(checker, required, self),
        called: signatureOf(checker, required, called),
        open,
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
      return pairs === undefined ? [] : bindingsOf(checker, { open, unknown: open }, pairs);
    }),
  ];
  const combined = findings.reduce<readonly Binding[]>(
    (sofar, options) =>
      sofar.flatMap((binding) => options.flatMap((option) => agreed(binding, option) ?? [])),
    [new Map()],
  );
  return combined.map(
    (binding): Constraint => ({
      trait,
      arguments: constraint.arguments.map((given, index) => {
        const parameter = parameters[index];
        return (parameter === undefined ? undefined : binding.get(parameter)) ?? given;
      }),
    }),
  );
}

/**
 * A requirement whose witness is sought: with `Self` as the type and the trait's `open` parameters
 * still to find (`required`), and as a call through `any` makes it (`called`).
 */
interface Requirement {
  readonly required: Signature;
  readonly called: Signature;
  readonly open: readonly TypeParameter[];
}

/** What each witness candidate of a requirement finds its trait's open parameters to be. */
function candidateBindings(
  checker: CheckerContext,
  found: Type,
  requirement: Requirement,
): readonly Binding[] {
  const { required } = requirement;
  const parameterTypes = required.parameters.map((slot) => slot.type);
  return witnessCandidates(checker, found, {
    required: required.declaration,
    parameterTypes,
  }).flatMap((candidate) => candidateBinding(checker, candidate, requirement) ?? []);
}

/**
 * What `candidate`, a witness candidate of a requirement, finds the trait's open parameters to be;
 * undefined when it can't stand for the requirement at all. It takes what the requirement takes as
 * a witness is chosen: a by-value literal as its base, and parameters past those left to their
 * defaults. Its own type parameters come from what a call through `any` passes it, each value
 * converting into what it takes; then every parameter and the result are matched exactly, and a
 * parameter it binds to a type its own type parameters leave open is no finding of it. A
 * requirement of a constraint, a type parameter's, is proposed whole by what the type is.
 */
function candidateBinding(
  checker: CheckerContext,
  candidate: Candidate,
  { required, called, open }: Requirement,
): Binding | undefined {
  const own = signatureOf(checker, candidate.declaration);
  const taken = required.parameters;
  const fits =
    candidate.requirement === undefined &&
    own.parameters.length >= taken.length &&
    own.parameters.every((slot, index) => {
      const slotTaken = taken[index];
      return slotTaken === undefined ? slot.hasDefault : slotTaken.reference === slot.reference;
    });
  if (!fits) {
    return undefined;
  }
  const instantiating = new Inference(own.typeParameters, checker.fitting);
  const passes = called.parameters.every((slot, index) => {
    const given = own.parameters[index];
    return given === undefined || instantiating.match(given.type, byValue(slot));
  });
  if (!passes) {
    return undefined;
  }
  const leftOpen = new Set<ParameterKey>(
    own.typeParameters.filter((parameter) => instantiating.boundOf(parameter) === undefined),
  );
  const pairs = [
    ...taken.flatMap((slot, index) => {
      const given = own.parameters[index];
      return given === undefined
        ? []
        : [[byValue(slot), instantiating.substituted(given.type)] as const];
    }),
    [required.result(), instantiating.substituted(own.result())] as const,
  ];
  const unknown = [...open, ...required.typeParameters];
  return bindingsOf(checker, { open, unknown, leftOpen }, pairs)[0];
}

/** What a slot takes, a by-value literal as its base, as a witness is chosen. */
function byValue(slot: SignatureSlot): Type {
  return !slot.reference && slot.type.kind === 'literal' ? baseOf(slot.type) : slot.type;
}

/** What a match finds: the trait's `open` parameters, among all `unknown` to it. */
interface Finding {
  readonly open: readonly TypeParameter[];
  readonly unknown: readonly ParameterKey[];
  /** The type parameters a generic candidate left open, which no finding mentions. */
  readonly leftOpen?: ReadonlySet<ParameterKey>;
}

/** What matching each declared type exactly against the given one finds the `open` ones to be. */
function bindingsOf(
  checker: CheckerContext,
  { open, unknown, leftOpen }: Finding,
  pairs: readonly (readonly [declared: Type, given: Type])[],
): readonly Binding[] {
  const inference = new Inference(unknown, checker.fitting);
  if (!pairs.every(([declared, given]) => inference.matchExactly(declared, given))) {
    return [];
  }
  const found = open.flatMap((parameter) => {
    const type = inference.boundOf(parameter);
    const unsettled =
      type === undefined || parametersIn(type).some((each) => leftOpen?.has(each) === true);
    return unsettled ? [] : [[parameter, type] as const];
  });
  return [new Map(found)];
}

/** `first` and `second` together, where they agree on every parameter both find. */
function agreed(first: Binding, second: Binding): Binding | undefined {
  for (const [parameter, type] of second) {
    const other = first.get(parameter);
    if (other !== undefined && !sameType(other, type)) {
      return undefined;
    }
  }
  return new Map([...first, ...second]);
}
