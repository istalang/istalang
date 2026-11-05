/**
 * Instantiating a chosen function and meeting its constraints (§3.5, §3.10).
 *
 * - A chosen generic function's type parameters that the arguments left open come from the type
 *   the call is expected to have, then from their defaults; one still open can't be inferred.
 * - Every type argument must meet its parameter's constraints. A type meets a trait with the same
 *   functions wherever it is met: those the trait requires must be declared beside the types they
 *   take or beside the trait, or be a requirement of a type parameter's own constraints
 *   (resolution/candidates.ts). Each is the function declared to meet it (declared-witness.ts),
 *   which must give the required result. The calls found are the witnesses the instantiation
 *   calls (check.ts).
 * - A required field or associated type, and a struct constraint's entries, are met as
 *   shortfalls.ts judges them.
 * - A trait the compiler derives (derived-traits.ts) asks what its rule asks of every type first,
 *   and a required function no function is declared for is met by the witness it derives. On a
 *   union, any other trait's is met through its members (union-traits.ts, §6).
 * - A requirement with type parameters of its own is met by a function generic in the same way:
 *   resolving the call with those parameters as opaque types infers the candidate's own.
 * - The required result is what the call is expected to give, so a type parameter no argument
 *   decides comes from it: `Array.default<T>()` meets `Self.default()` for `Array<Int>` with `T`
 *   as `Int`.
 * - A witness search that fails is reported once, as the constraint not met, so searching itself
 *   reports nothing (`UseSite.report`). A search can recurse without end, when a witness needs
 *   the same constraint again for a type as large or larger; it is bounded, and one that reaches
 *   the bound is reported as such, at every level up to the use site.
 */

import type { FunctionDeclaration, TypeParameter } from '../../syntax/declarations.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type Completion, completeInference } from '../inference/complete.ts';
import type { ResolvedCall, Witnesses } from '../resolved-call.ts';
import { constraintSubstitution, requiredFunctions, traitAsAny } from '../traits/constraints.ts';
import { sameType } from '../types/identity.ts';
import { standsForMember } from '../types/member-arguments.ts';
import { type Substitution, substitute, substituteConstraint } from '../types/substitution.ts';
import { type Constraint, errorType, type Type } from '../types/type.ts';
import { mentionsError } from '../types/type-parts.ts';
import { typeText } from '../types/type-text.ts';
import { silent, type UseSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import { type Application, type Choice, type Signature, signatureOf } from './choice.ts';
import { chooseWitness, chooseWitnessAmong } from './declared-witness.ts';
import { type Derivation, derivationOf } from './derived-traits.ts';
import {
  associatedShortfall,
  fieldShortfall,
  type Meets,
  meetsStructConstraints,
} from './shortfalls.ts';
import { type MembersMeeting, membersCall, membersShortfall } from './union-traits.ts';
import type { ConformanceOutcome } from './witness-outcomes.ts';
import { type Failure, isFailure, maximumDepth, type WitnessOutcome } from './witness-outcomes.ts';

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
  const instantiation = instantiateAt(site, application, expected, 0);
  if (isFailure(instantiation)) {
    return undefined;
  }
  const { substitution, witnesses } = instantiation;
  site.instantiates(application.signature.declaration, substitution, witnesses);
  return instantiation;
}

/** `instantiate`, within witness searches nested `depth` deep. */
function instantiateAt(
  site: UseSite,
  application: Application,
  expected: Type | undefined,
  depth: number,
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
  const witnesses = witnessesOf(site, typeParameters, completion, depth);
  return isFailure(witnesses) ? witnesses : { typeArguments, substitution, witnesses };
}

/** The witnesses of every constraint on `parameters`, given their arguments. */
function witnessesOf(
  site: UseSite,
  parameters: readonly TypeParameter[],
  { typeArguments, substitution }: Extract<Completion, { kind: 'complete' }>,
  depth: number,
): Witnesses | Failure {
  const witnesses = new Map<TypeParameter, readonly (readonly ResolvedCall[])[]>();
  for (const [index, parameter] of parameters.entries()) {
    const argument = typeArguments[index] ?? errorType;
    const given = { argument, substitution };
    const struct = () => meetsStructConstraints(site, parameter, given, silentMeets(site, depth));
    if (!(standsForMember(site, parameter, argument, substitution) && struct())) {
      return 'failed';
    }
    const met: (readonly ResolvedCall[])[] = [];
    for (const constraint of site.checker.constraintsOf(parameter)) {
      const mapped = substituteConstraint(constraint, substitution, site.checker.typeRules);
      const witnessesOfConstraint = conform({ site, type: argument, constraint: mapped }, depth);
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

/**
 * The witness of every function `constraint` requires of `type` at the use site; undefined after
 * reporting there why it isn't met.
 */
export function witnessesFor(
  site: UseSite,
  type: Type,
  constraint: Constraint,
): readonly ResolvedCall[] | undefined {
  const witnesses = conform({ site, type, constraint }, 0);
  return isFailure(witnesses) ? undefined : witnesses;
}

/**
 * The witnesses a call through `constraint`'s trait on a value of `type`, a union, runs (§6): its
 * required functions, through its members or declared for it whole. A union has no associated type
 * (§3.1), each member its own, which such a call never reads of the union itself. Undefined after
 * reporting at `site` why it can't be called so.
 */
export function callWitnessesFor(
  site: UseSite,
  type: Type,
  constraint: Constraint,
): readonly ResolvedCall[] | undefined {
  const witnesses = conform({ site, type, constraint, onValues: true }, 0);
  return isFailure(witnesses) ? undefined : witnesses;
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
  const witnesses = conform({ site, type, constraint }, 0, () => {
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
 * is `unmet`'s, by default the one a derived trait derives, else reported missing. A type already
 * in error was reported, so it fails silently.
 */
function conform(
  meeting: Meeting,
  depth: number,
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
      : associatedShortfall(checker, type, constraint, silentMeets(site, depth)));
  if (missing !== undefined) {
    return lacks(meeting, missing);
  }
  return functionWitnesses(meeting, depth, unmet ?? undeclaredWitness(meeting, derivation, depth));
}

/**
 * A constraint being met by a type at a use site, for reporting why it isn't; `onValues` when only
 * calls on its values need it met, as by a union's members (`callWitnessesFor`).
 */
interface Meeting {
  readonly site: UseSite;
  readonly type: Type;
  readonly constraint: Constraint;
  readonly onValues?: boolean;
}

/** Whether a type meets a constraint, searched `depth` deep, reporting nothing. */
function silentMeets(site: UseSite, depth: number): Meets {
  return (type, constraint) =>
    !isFailure(conform({ site: silent(site), type, constraint }, depth + 1));
}

/** Reports that the type lacks `missing` to meet the constraint. */
function lacks({ site, type, constraint }: Meeting, missing: string): Failure {
  const trait = constraint.trait.name.text;
  site.report((at) => checkerDiagnostics.notConforming(at, typeText(type), trait, missing));
  return 'failed';
}

/**
 * What meets a required function no function is declared for: the witness `derivation` derives
 * for the type; on a union, where no rule derives the trait, the function of whichever member a
 * value is; or else nothing, reported as what the type lacks to have one, by default the function
 * itself.
 */
function undeclaredWitness(
  meeting: Meeting,
  derivation: Derivation | undefined,
  depth: number,
): (declaration: FunctionDeclaration) => ResolvedCall | Failure {
  const { site, type, constraint } = meeting;
  return (declaration) => {
    if (type.kind === 'union' && derivation?.derive === undefined) {
      const through = traitAsAny(constraint, type);
      return throughMembers(meeting, { union: type, through, declaration }, depth);
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
 * The witness of a required function a union meets through its members: the function itself,
 * called on whichever member a value is; reported as what the union lacks when it can't.
 */
function throughMembers(
  meeting: Meeting,
  members: MembersMeeting,
  depth: number,
): ResolvedCall | Failure {
  const { site, type, constraint } = meeting;
  const { checker } = site;
  const memberMeets = (member: Type, met: Constraint) =>
    !isFailure(conform({ site: silent(site), type: member, constraint: met }, depth + 1));
  const shortfall = membersShortfall(checker, members, memberMeets);
  if (shortfall !== undefined) {
    return lacks(meeting, shortfall);
  }
  const { union, through, declaration } = members;
  const index = requiredFunctions(constraint.trait).indexOf(declaration);
  const signature = signatureOf(checker, declaration, constraintSubstitution(constraint, type));
  const candidate = membersCall(checker.typeRules, union, through, { declaration, member: index });
  const choice = chooseWitnessAmong(checker, [candidate], signature);
  const witness = witnessChosen(site, choice, signature, depth);
  return witness.kind === 'call' ? witness.call : 'failed';
}

/**
 * The witness of every function the constraint requires; one no function is declared for is
 * `unmet`'s.
 */
function functionWitnesses(
  meeting: Meeting,
  depth: number,
  unmet: (declaration: FunctionDeclaration) => ResolvedCall | Failure,
): readonly ResolvedCall[] | Failure {
  const { site, type, constraint } = meeting;
  const substitution = constraintSubstitution(constraint, type);
  const witnesses: ResolvedCall[] = [];
  for (const declaration of requiredFunctions(constraint.trait)) {
    const required = { declaration, substitution };
    const witness: WitnessOutcome =
      depth < maximumDepth ? witnessOf(site, type, required, depth) : { kind: 'endless' };
    switch (witness.kind) {
      case 'call':
        witnesses.push(witness.call);
        break;
      case 'none': {
        const met = unmet(declaration);
        if (isFailure(met)) {
          return met;
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
      case 'endless': {
        if (depth === 0) {
          const trait = constraint.trait.name.text;
          site.report((at) => checkerDiagnostics.endlessConformance(at, typeText(type), trait));
        }
        return 'endless';
      }
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

/** A function a trait requires, mapped for the type that must meet it. */
interface RequiredFunction {
  readonly declaration: FunctionDeclaration;
  readonly substitution: Substitution;
}

/**
 * The witness meeting `required` for `type`, or why none does: `none` only when no candidate is
 * declared, so a declared candidate whose own constraints fail reports them at `site`.
 */
function witnessOf(
  site: UseSite,
  type: Type,
  required: RequiredFunction,
  depth: number,
): WitnessOutcome {
  const signature = signatureOf(site.checker, required.declaration, required.substitution);
  return witnessChosen(site, chooseWitness(site.checker, type, signature), signature, depth);
}

/**
 * The witness `choice` found for the required function `signature`, instantiated, or why there is
 * none. A required result of the error type, explained already or standing for any type (a call
 * on a union probing a trait for arguments it infers later, trait-calls.ts), takes any result.
 */
function witnessChosen(
  site: UseSite,
  choice: Choice,
  signature: Signature,
  depth: number,
): WitnessOutcome {
  if (choice.kind === 'none') {
    return { kind: 'none' };
  }
  if (choice.kind === 'several') {
    return { kind: 'ambiguous' };
  }
  const { application } = choice;
  const instantiation = instantiateAt(site, application, signature.result(), depth + 1);
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
