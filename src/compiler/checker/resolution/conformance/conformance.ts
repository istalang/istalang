/**
 * Instantiating a chosen function and meeting its constraints (§3.5, §3.10).
 *
 * - A chosen generic function's type parameters that the arguments left open come from the type
 *   the call is expected to have, then from their defaults; one still open can't be inferred.
 * - Every type argument must meet its parameter's constraints. A type meets a trait with the same
 *   functions wherever it is met: those the trait requires must be declared beside the types they
 *   take or beside the trait, or be a requirement of a type parameter's own constraints
 *   (resolution/choosing/candidates.ts). Each is the function declared to meet it
 *   (declared-witness.ts), which must give the required result. The calls found are the witnesses
 *   the instantiation calls (check.ts).
 * - A required field or associated type, and a struct constraint's entries, are met as
 *   shortfalls.ts judges them.
 * - A trait the compiler derives (derived-traits.ts) asks what its rule asks of every type first,
 *   and a required function no function is declared for is met by the witness it derives. On a
 *   union, any other trait's is met through its members (union-traits.ts, §6).
 * - Struct-constraint field checks (shortfalls.ts) and union-member checks (`throughMembers`) are
 *   coinductive on the active search stack for concrete types: a `(struct, struct constraint)` or
 *   `(union, constraint)` goal already active counts as met (`silentMeets`). A search judges each
 *   goal once (witness-outcomes.ts `SearchGoals`), finding a failure again where its site reports.
 * - A goal asked at the root, a trait's or a struct constraint's, is searched once per program
 *   (`rootSearches`, kept by root-goals.ts), each site asking making its reports again.
 * - A requirement with type parameters of its own is met by a function generic in the same way:
 *   resolving the call with those parameters as opaque types infers the candidate's own.
 * - The required result is what the call is expected to give, so a type parameter no argument
 *   decides comes from it: `Array.default<T>()` meets `Self.default()` for `Array<Int>` with `T`
 *   as `Int`.
 * - A witness search that fails is reported once, as the constraint not met, so searching itself
 *   reports nothing (`UseSite.report`). A search can recurse without end, when a witness needs
 *   the same constraint again for a type as large or larger; it is bounded, and one that reaches
 *   the bound is reported as such at the root use site.
 */

import type { FunctionDeclaration, TypeParameter } from '../../../syntax/declarations/index.ts';
import type { RootGoals } from '../../contexts/context.ts';
import { silent, type UseSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { ResolvedCall, Witnesses } from '../../surface/resolved-call.ts';
import { standsForMember } from '../../types/fitting/member-arguments.ts';
import { sameType } from '../../types/identity/identity.ts';
import { type Completion, completeInference } from '../../types/inference/complete.ts';
import {
  type Substitution,
  substitute,
  substituteConstraint,
} from '../../types/parts/substitution.ts';
import { mentionsError } from '../../types/parts/type-parts.ts';
import {
  constraintSubstitution,
  requiredFunctions,
  traitAsAny,
} from '../../types/traits/constraints.ts';
import type { Constraint, Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { callMade } from '../choosing/calls-made.ts';
import { type Application, type Choice, type Signature, signatureOf } from '../choosing/choice.ts';
import { chooseWitness, chooseWitnessAmong } from './declared-witness.ts';
import { type Derivation, derivationOf } from './derived-traits.ts';
import {
  associatedShortfall,
  fieldShortfall,
  type Meets,
  meetsStructConstraints,
  meetsStructModel,
} from './shortfalls.ts';
import { type MembersMeeting, membersCall, membersShortfall } from './union-traits.ts';
import {
  boundReached,
  type ConformanceOutcome,
  deeper,
  endlessAt,
  type Failure,
  goalKey,
  isFailure,
  maximumDepth,
  meetsWith,
  type Search,
  startSearch,
  type WitnessOutcome,
} from './witness-outcomes.ts';

/** A chosen function, complete: its type arguments, and the witnesses of its constraints. */
export interface Instantiation {
  readonly typeArguments: readonly Type[];
  readonly substitution: Substitution;
  readonly witnesses: Witnesses;
}

/**
 * Completes `application`: open type parameters from `expected`, then their defaults, then every
 * constraint met, its type `match`es and its witnesses' noted to reduce. Undefined after reporting
 * why it can't be.
 */
export function instantiate(
  site: UseSite,
  application: Application,
  expected: Type | undefined,
): Instantiation | undefined {
  const instantiation = instantiateAt(site, application, expected, startSearch());
  if (isFailure(instantiation)) {
    return undefined;
  }
  const { substitution, witnesses } = instantiation;
  site.instantiates(application.signature.declaration, substitution, witnesses);
  return instantiation;
}

/** `instantiate`, within `search`. */
function instantiateAt(
  site: UseSite,
  application: Application,
  expected: Type | undefined,
  search: Search,
): Instantiation | Failure {
  const { checker } = site;
  const { signature, inference } = application;
  const { declaration, typeParameters } = signature;
  if (expected !== undefined && typeParameters.some((each) => !inference.boundOf(each))) {
    inference.matchExactly(signature.result(), expected);
  }
  const completion = completeInference(checker, declaration, typeParameters, inference);
  if (completion.kind === 'open') {
    const parameter = completion.parameter.name.text;
    site.report((at) => checkerDiagnostics.cannotInfer(at, declaration.name.text, parameter));
    return 'failed';
  }
  const { typeArguments, substitution } = completion;
  const witnesses = witnessesOf(site, typeParameters, completion, search);
  return isFailure(witnesses) ? witnesses : { typeArguments, substitution, witnesses };
}

/** The witnesses of every constraint on `parameters`, given their arguments. */
function witnessesOf(
  site: UseSite,
  parameters: readonly TypeParameter[],
  { typeArguments, substitution }: Extract<Completion, { kind: 'complete' }>,
  search: Search,
): Witnesses | Failure {
  const witnesses = new Map<TypeParameter, readonly (readonly ResolvedCall[])[]>();
  for (const [index, parameter] of parameters.entries()) {
    const argument = typeArguments[index] ?? errorType;
    const given = { argument, substitution };
    const struct = () =>
      meetsStructConstraints(site, parameter, given, (type, model) =>
        meetsStructModel(site, type, model, silentMeets(site, search)),
      );
    if (!(standsForMember(site, parameter, argument, substitution) && struct())) {
      return search.endless === undefined ? 'failed' : 'endless';
    }
    const met: (readonly ResolvedCall[])[] = [];
    for (const constraint of site.checker.constraintsOf(parameter)) {
      const mapped = substituteConstraint(constraint, substitution, site.checker.typeRules);
      const meeting = { site, type: argument, constraint: mapped };
      const witnessesOfConstraint = search.goals.witnessesReported(meetingKey(meeting), () =>
        conform(meeting, search),
      );
      if (isFailure(witnessesOfConstraint)) {
        return witnessesOfConstraint;
      }
      met.push(witnessesOfConstraint);
    }
    witnesses.set(parameter, met);
  }
  return witnesses;
}

/** Whether `type` meets `constraint` at the use site, reporting there when it doesn't. */
export function meets(site: UseSite, type: Type, constraint: Constraint): boolean {
  return witnessesFor(site, type, constraint) !== undefined;
}

/** The witness of every function `constraint` requires of `type` at `site`, or undefined. */
export function witnessesFor(
  site: UseSite,
  type: Type,
  constraint: Constraint,
): readonly ResolvedCall[] | undefined {
  return site.checker.rootGoals.witnesses(site, { type, constraint, onValues: false });
}

/** How a goal is searched from its root at a site, which root-goals.ts keeps the answer of. */
export const rootSearches: RootGoals = {
  witnesses: (site, goal) => {
    const witnesses = conform({ site, ...goal }, startSearch());
    return isFailure(witnesses) ? undefined : witnesses;
  },
  structMet: (site, { type, model }) => meetsStructModel(site, type, model, silentMeets(site)),
};

/**
 * The witnesses a call through `constraint`'s trait on a value of `type`, a union, runs (§6): its
 * required functions, through its members or declared for it whole, with no associated type of the
 * union itself. Undefined after reporting at `site` why it can't be called so.
 */
export function callWitnessesFor(
  site: UseSite,
  type: Type,
  constraint: Constraint,
): readonly ResolvedCall[] | undefined {
  return site.checker.rootGoals.witnesses(site, { type, constraint, onValues: true });
}

/**
 * The witnesses of `constraint` for `type`: `undeclared` without reporting when a required
 * function has no declared candidate, or `failed` after reporting at `site` why `type` doesn't
 * meet `constraint`.
 */
export function conformWitnesses(
  site: UseSite,
  type: Type,
  constraint: Constraint,
): ConformanceOutcome {
  let undeclared = false;
  const witnesses = conform({ site, type, constraint }, startSearch(), () => {
    undeclared = true;
    return 'failed';
  });
  if (!isFailure(witnesses)) {
    return { kind: 'met', witnesses };
  }
  return undeclared ? { kind: 'undeclared' } : { kind: 'failed' };
}

/**
 * The witness of every function `constraint` requires of `type`; one no function is declared for
 * is `unmet`'s, by default the one a derived trait derives, else reported missing.
 */
function conform(
  meeting: Meeting,
  search: Search,
  unmet?: (declaration: FunctionDeclaration) => ResolvedCall | Failure,
): readonly ResolvedCall[] | Failure {
  const { site, type, constraint } = meeting;
  if (type.kind === 'error') {
    return 'failed';
  }
  const { checker } = site;
  const derivation = derivationOf(checker, constraint.trait);
  const missing =
    derivation?.lacking(site, type) ??
    fieldShortfall(checker, type, constraint) ??
    (meeting.onValues === true
      ? undefined
      : associatedShortfall(checker, type, constraint, silentMeets(site, search)));
  if (missing !== undefined) {
    return search.endless === undefined
      ? lacks(meeting, missing)
      : endlessAt(site, search, type, constraint);
  }
  return functionWitnesses(
    meeting,
    search,
    unmet ?? undeclaredWitness(meeting, derivation, search),
  );
}

/**
 * A constraint being met by a type at a use site, `onValues` when only calls on its values need it.
 */
interface Meeting {
  readonly site: UseSite;
  readonly type: Type;
  readonly constraint: Constraint;
  readonly onValues?: boolean;
}

/** The goal `meeting` is, as a search keeps it (`SearchGoals`). */
function meetingKey({ site, type, constraint }: Meeting): string {
  return goalKey(site.checker.typeKeys, type, constraint);
}

/**
 * How a search judges traits and active goals (`Meets`, shortfalls.ts) without reporting unmet
 * ones.
 */
export function silentMeets(site: UseSite, search: Search = startSearch()): Meets {
  return meetsWith(site, search, (type, constraint) => {
    const meeting = { site: silent(site), type, constraint };
    return search.goals.witnesses(meetingKey(meeting), () => conform(meeting, deeper(search)));
  });
}

/** Reports that the type lacks `missing` to meet the constraint. */
function lacks({ site, type, constraint }: Meeting, missing: string): Failure {
  const trait = constraint.trait.name.text;
  site.report((at) => checkerDiagnostics.notConforming(at, typeText(type), trait, missing));
  return 'failed';
}

/**
 * What meets a required function no function is declared for: derived, union members, or missing.
 */
function undeclaredWitness(
  meeting: Meeting,
  derivation: Derivation | undefined,
  search: Search,
): (declaration: FunctionDeclaration) => ResolvedCall | Failure {
  const { site, type, constraint } = meeting;
  return (declaration) => {
    if (type.kind === 'union' && derivation?.derive === undefined) {
      const through = traitAsAny(constraint, type);
      return throughMembers(meeting, { union: type, through, declaration }, search);
    }
    const derived = derivation?.derive?.(site, type);
    if (derived?.kind === 'derived') {
      return derived.call;
    }
    const required = `'${declaration.name.text}' as ${constraint.trait.name.text} declares it`;
    return lacks(meeting, derived?.missing ?? required);
  };
}

/**
 * The witness of a required function a union meets through its members (`enter` is coinductive).
 */
function throughMembers(
  meeting: Meeting,
  members: MembersMeeting,
  search: Search,
): ResolvedCall | Failure {
  const { site, type, constraint } = meeting;
  const { checker } = site;
  const memberMeets = silentMeets(site, search);
  const shortfall = memberMeets.enter(members.union, constraint, () =>
    membersShortfall(checker, members, memberMeets),
  );
  if (shortfall !== undefined) {
    return search.endless === undefined ? lacks(meeting, shortfall) : 'endless';
  }
  const { union, through, declaration } = members;
  const index = requiredFunctions(constraint.trait).indexOf(declaration);
  const signature = signatureOf(checker, declaration, constraintSubstitution(constraint, type));
  const candidate = membersCall(checker.typeRules, union, through, { declaration, member: index });
  const choice = chooseWitnessAmong(checker, [candidate], signature);
  const witness = witnessChosen(site, choice, signature, search);
  if (witness.kind === 'call') {
    return witness.call;
  }
  return isFailure(witness.kind) ? witness.kind : 'failed';
}

function functionWitnesses(
  meeting: Meeting,
  search: Search,
  unmet: (declaration: FunctionDeclaration) => ResolvedCall | Failure,
): readonly ResolvedCall[] | Failure {
  const { site, type, constraint } = meeting;
  const substitution = constraintSubstitution(constraint, type);
  const witnesses: ResolvedCall[] = [];
  for (const declaration of requiredFunctions(constraint.trait)) {
    const required = { declaration, substitution };
    const witness: WitnessOutcome =
      search.depth < maximumDepth ? witnessOf(site, type, required, search) : boundReached(search);
    switch (witness.kind) {
      case 'call':
        witnesses.push(witness.call);
        break;
      case 'none': {
        const met = unmet(declaration);
        if (isFailure(met)) {
          return met === 'endless' ? endlessAt(site, search, type, constraint) : met;
        }
        witnesses.push(met);
        break;
      }
      case 'ambiguous':
        return lacks(
          meeting,
          `a single '${declaration.name.text}' as ${meeting.constraint.trait.name.text} declares it`,
        );
      case 'wrongResult': {
        const name = declaration.name.text;
        const [wanted, given] = [typeText(witness.required), typeText(witness.given)];
        return lacks(meeting, `'${name}' giving ${wanted}, where the one declared gives ${given}`);
      }
      case 'endless':
        return endlessAt(site, search, type, constraint);
      case 'failed':
        return 'failed';
      default: {
        const unhandled: never = witness;
        return unhandled;
      }
    }
  }
  return witnesses;
}

interface RequiredFunction {
  readonly declaration: FunctionDeclaration;
  readonly substitution: Substitution;
}

function witnessOf(
  site: UseSite,
  type: Type,
  required: RequiredFunction,
  search: Search,
): WitnessOutcome {
  const signature = signatureOf(site.checker, required.declaration, required.substitution);
  return witnessChosen(site, chooseWitness(site.checker, type, signature), signature, search);
}

function witnessChosen(
  site: UseSite,
  choice: Choice,
  signature: Signature,
  search: Search,
): WitnessOutcome {
  if (choice.kind === 'none') {
    return { kind: 'none' };
  }
  if (choice.kind === 'several') {
    return { kind: 'ambiguous' };
  }
  const { application } = choice;
  const instantiation = instantiateAt(site, application, signature.result(), deeper(search));
  if (isFailure(instantiation)) {
    return { kind: instantiation };
  }
  const result = substitute(
    application.signature.result(),
    instantiation.substitution,
    site.checker.typeRules,
  );
  const required = signature.result();
  if (!(mentionsError(required) || sameType(result, required))) {
    return { kind: 'wrongResult', required, given: result };
  }
  return { kind: 'call', call: callMade(application, instantiation) };
}
