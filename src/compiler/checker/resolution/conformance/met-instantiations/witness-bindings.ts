/**
 * What the witness candidates of a trait's requirements find its parameters to be (index.ts): each
 * candidate matched as a witness is chosen (declared-witness.ts), what a call through `any` passes
 * giving its own type parameters, and the type's own parameters found too only where no witness
 * for every instantiation stands, so one declared for one instantiation says which it is.
 */

import type { TypeParameter } from '../../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { sameType } from '../../../types/identity/identity.ts';
import { Inference } from '../../../types/inference/infer.ts';
import { substitute } from '../../../types/parts/substitution.ts';
import { parametersIn } from '../../../types/parts/type-parts.ts';
import type { ParameterKey, Type } from '../../../types/type/index.ts';
import { baseOf } from '../../../types/unions/union-members.ts';
import { parameterType } from '../../../types/written/resolve-type.ts';
import type { SignatureSlot } from '../../choosing/call-arguments.ts';
import { type Candidate, witnessCandidates } from '../../choosing/candidates.ts';
import { candidateSignature, type Signature } from '../../choosing/choice.ts';
import type { RequiredSignature } from '../declared-witness.ts';

/** What each witness candidate of a required function finds its trait's open parameters to be. */
export function candidateBindings(
  checker: CheckerContext,
  found: Type,
  requirement: Requirement & { readonly required: Signature },
): readonly Binding[] {
  const { required } = requirement;
  const parameterTypes = required.parameters.map((slot) => slot.type);
  const candidates = witnessCandidates(checker, found, {
    required: required.declaration,
    parameterTypes,
  });
  return bindingsAmong(checker, candidates, requirement);
}

/**
 * What each of `candidates`, witnesses of a requirement, finds its trait's open parameters to be:
 * a required function's, or the getters of a field a type stores none of (§3.10).
 */
export function bindingsAmong(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  requirement: Requirement,
): readonly Binding[] {
  return candidates.flatMap((candidate) => candidateBinding(checker, candidate, requirement) ?? []);
}

/** What matching each declared type exactly against the given one finds the `open` ones to be. */
export function bindingsOf(
  checker: CheckerContext,
  { reported, unknown, leftOpen }: Finding,
  pairs: readonly (readonly [declared: Type, given: Type])[],
): readonly Binding[] {
  const inference = new Inference(unknown, checker.fitting);
  if (!pairs.every(([declared, given]) => inference.matchExactly(declared, given))) {
    return [];
  }
  const found = reported.flatMap((parameter) => {
    const type = inference.boundOf(parameter);
    const unsettled =
      type === undefined || parametersIn(type).some((each) => leftOpen?.has(each) === true);
    return unsettled ? [] : [[parameter, type] as const];
  });
  return [new Map(found)];
}

/** `first` and `second` together, where they agree on every parameter both find. */
export function agreed(first: Binding, second: Binding): Binding | undefined {
  for (const [parameter, type] of second) {
    const other = first.get(parameter);
    if (other !== undefined && !sameType(other, type)) {
      return undefined;
    }
  }
  return new Map([...first, ...second]);
}

/**
 * A requirement whose witness is sought: with `Self` as the type and the trait's `open` parameters
 * still to find (`required`), and as a call through `any` makes it (`called`), passing nothing
 * where it mentions a parameter `unsought`; the type's own `free` parameters found only where its
 * witness is declared for one instantiation of it.
 */
interface Requirement {
  readonly required: RequiredSignature;
  readonly called: RequiredSignature;
  readonly open: readonly TypeParameter[];
  readonly unsought: readonly ParameterKey[];
  readonly free: readonly ParameterKey[];
}

/** What the trait's parameters, and the type's own where a witness says, were found to be. */
export type Binding = ReadonlyMap<ParameterKey, Type>;

/**
 * What `candidate`, a witness candidate of a requirement, finds the trait's open parameters to be;
 * undefined when it can't stand for the requirement at all. It takes what the requirement takes as
 * a witness is chosen: a by-value literal as its base, and parameters past those left to their
 * defaults. Its own type parameters come from what a call through `any` passes it, each value
 * converting into what it takes; then every parameter and the result are matched exactly, and a
 * parameter it binds to a type its own type parameters leave open is no finding of it. A
 * requirement of a type parameter's or an `any` type's constraint stands as any function does, its
 * trait mapped as the constraint says: `T is MySource<Int>` meets `Source<Int>` through `next`.
 */
function candidateBinding(
  checker: CheckerContext,
  candidate: Candidate,
  requirement: Requirement,
): Binding | undefined {
  const { free } = requirement;
  return (
    bindingAs(checker, candidate, requirement, []) ??
    (free.length === 0 ? undefined : bindingAs(checker, candidate, requirement, free))
  );
}

/**
 * `candidateBinding` with the type's parameters `found` among what is found: none first, so a
 * witness for every instantiation finds the trait's parameters in the type's own; then the type's
 * own, so a witness declared for one instantiation finds which.
 */
function bindingAs(
  checker: CheckerContext,
  candidate: Candidate,
  { required, called, open, unsought }: Requirement,
  found: readonly ParameterKey[],
): Binding | undefined {
  const own = candidateSignature(checker, candidate);
  const taken = required.parameters;
  const fits =
    own.parameters.length >= taken.length &&
    own.parameters.every((slot, index) => {
      const slotTaken = taken[index];
      return slotTaken === undefined ? slot.hasDefault : slotTaken.reference === slot.reference;
    });
  if (!fits) {
    return undefined;
  }
  const instantiating = new Inference([...own.typeParameters, ...found], checker.fitting);
  // What is passed holds the type's parameters `found`, open there as inference's variables; the
  // candidate's own stay rigid where passed, as a call's do (types/inference/variables.ts).
  const openFound = new Map(
    found.map((key) => [key, instantiating.open(parameterType(key))] as const),
  );
  const passes = called.parameters.every((slot, index) => {
    const given = own.parameters[index];
    if (given === undefined || parametersIn(slot.type).some((each) => unsought.includes(each))) {
      return true;
    }
    const passed = substitute(byValue(slot), openFound, checker.typeRules);
    // The receiver binds exactly, as a method's does wherever it is called (§3.5).
    return slot.isReceiver
      ? instantiating.matchReceiver(given.type, passed, slot.reference)
      : instantiating.match(given.type, passed);
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
  const unknown = [...open, ...required.typeParameters, ...found];
  return bindingsOf(checker, { reported: [...open, ...found], unknown, leftOpen }, pairs)[0];
}

/** What a slot takes, a by-value literal as its base, as a witness is chosen. */
function byValue(slot: SignatureSlot): Type {
  return !slot.reference && slot.type.kind === 'literal' ? baseOf(slot.type) : slot.type;
}

/** What a match finds: the parameters `reported`, among all `unknown` to it. */
interface Finding {
  readonly reported: readonly ParameterKey[];
  readonly unknown: readonly ParameterKey[];
  /** The type parameters a generic candidate left open, which no finding mentions. */
  readonly leftOpen?: ReadonlySet<ParameterKey>;
}
