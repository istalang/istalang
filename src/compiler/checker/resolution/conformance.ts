/**
 * Instantiating a chosen function and meeting its constraints (§3.5, §3.10).
 *
 * - A chosen generic function's type parameters that the arguments left open come from the type
 *   the call is expected to have, then from their defaults; one still open can't be inferred.
 * - Every type argument must meet its parameter's constraints. A type meets a trait where it is
 *   met: the functions the trait requires must be visible there, in scope, through argument-
 *   dependent lookup on the type, or as a requirement of a type parameter's own constraints. Each
 *   is found by resolving a call to it with the required parameter types, taken exactly: a
 *   function taking the type only once wrapped into an optional is one for the optional, not
 *   for it. It must give the required result. The calls found are the witnesses the
 *   instantiation calls (check.ts).
 * - A required field is met by a struct field of the same name and type, or by a constraint on a
 *   type parameter requiring it too. `Sendable` is derived (traits/sendable.ts), and so are `Encodable`
 *   and `Decodable`: a JSON form (rules/json-forms/), and sendable, since each implies `Sendable`.
 *   A disposable host type has a form, to cross to its own host, yet isn't sendable.
 * - A requirement with type parameters of its own is met by a function generic in the same way:
 *   resolving the call with those parameters as opaque types infers the candidate's own.
 * - The required result is what the call is expected to give, so a type parameter no argument
 *   decides comes from it: `Array.default<T>()` meets `Self.default()` for `Array<int>` with `T`
 *   as `int`.
 * - A witness search that fails is reported once, as the constraint not met, so searching itself
 *   reports nothing (`UseSite.report`). A search can recurse without end, when a witness needs
 *   the same constraint again for a type as large or larger; it is bounded, and one that reaches
 *   the bound is reported as such, at every level up to the use site.
 */

import type {
  FunctionDeclaration,
  TraitDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';
import type { ResolvedCall, Witnesses } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type Completion, completeInference } from '../inference/complete.ts';
import { type JsonDirection, jsonMarkers } from '../json-form.ts';
import {
  type Constraint,
  constraintSubstitution,
  requiredFields,
  requiredFieldType,
  requiredFunctions,
} from '../traits/constraints.ts';
import { isSendable, isSendableTrait, isWellKnownTrait } from '../traits/sendable.ts';
import { errorType, type Substitution, sameType, substitute, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { silent, type UseSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import {
  type Candidate,
  staticCandidates,
  staticTargetOf,
  topLevelCandidates,
} from './candidates.ts';
import { type Application, type CallArgument, choose, signatureOf } from './choice.ts';

/** A chosen function, complete: its type arguments, and the witnesses of its constraints. */
export interface Instantiation {
  readonly typeArguments: readonly Type[];
  readonly substitution: Substitution;
  readonly witnesses: Witnesses;
}

/** How deeply witness searches nest before one counts as endless. */
const maximumDepth = 16;

/**
 * Why a search failed, after reporting it at its use site: `endless` when a witness search reached
 * the depth bound, which every level up reports as such, and `failed` for any other cause.
 */
type Failure = 'failed' | 'endless';

function isFailure<Found>(outcome: Found | Failure): outcome is Failure {
  return outcome === 'failed' || outcome === 'endless';
}

/**
 * Completes `application`: open type parameters from `expected`, then their defaults, then every
 * constraint met. Undefined after reporting at the use site why it can't be.
 */
export function instantiate(
  site: UseSite,
  application: Application,
  expected: Type | undefined,
): Instantiation | undefined {
  const instantiation = instantiateAt(site, application, expected, 0);
  return isFailure(instantiation) ? undefined : instantiation;
}

/** `instantiate`, within witness searches nested `depth` deep. */
function instantiateAt(
  site: UseSite,
  application: Application,
  expected: Type | undefined,
  depth: number,
): Instantiation | Failure {
  const { checker, at } = site;
  const { signature, inference, candidate } = application;
  const { declaration, typeParameters } = signature;
  if (expected !== undefined && typeParameters.some((each) => !inference.boundOf(each))) {
    inference.matchExactly(signature.result(), expected);
  }
  const completion = completeInference(checker, declaration, typeParameters, inference);
  if (completion.kind === 'open') {
    const parameter = completion.parameter.name.text;
    site.report(checkerDiagnostics.cannotInfer(at, declaration.name.text, parameter));
    return 'failed';
  }
  const { typeArguments, substitution } = completion;
  const witnesses =
    candidate.requirement === undefined
      ? witnessesOf(site, typeParameters, completion, depth)
      : new Map();
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
    const met: (readonly ResolvedCall[])[] = [];
    for (const constraint of site.checker.constraintsOf(parameter)) {
      const mapped = substituteConstraint(constraint, substitution);
      const witnessesOfConstraint = conform(site, argument, mapped, depth);
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
  return !isFailure(conform(site, type, constraint, 0));
}

/** Where a witness for `required` may come from: calls of its name, or statics of `type`. */
function witnessCandidates(
  { checker, module }: UseSite,
  type: Type,
  required: FunctionDeclaration,
  parameterTypes: readonly Type[],
): readonly Candidate[] {
  const name = required.name.text;
  if (required.owner === undefined) {
    return topLevelCandidates(checker, module, name, parameterTypes);
  }
  const target = staticTargetOf(checker, type);
  return target === undefined ? [] : staticCandidates(checker, module, target, name);
}

/**
 * The witness of every function `constraint` requires of `type`. A type already in error was
 * reported, so it fails silently.
 */
function conform(
  site: UseSite,
  type: Type,
  constraint: Constraint,
  depth: number,
): readonly ResolvedCall[] | Failure {
  const { checker } = site;
  if (type.kind === 'error') {
    return 'failed';
  }
  const meeting = { site, type, constraint };
  if (isSendableTrait(checker, constraint.trait)) {
    return isSendable(checker, type) ? [] : lacks(meeting, 'every value inside it to be sendable');
  }
  const direction = jsonMarkerDirection(checker, constraint.trait);
  if (direction !== undefined) {
    const problem = checker.json.problemOf(type, direction);
    if (problem !== undefined) {
      return lacks(meeting, `a JSON form to ${direction}, but ${problem}`);
    }
    return isSendable(checker, type) ? [] : lacks(meeting, 'every value inside it to be sendable');
  }
  for (const field of requiredFields(constraint.trait)) {
    const fieldType = requiredFieldType(checker, constraint, field, type);
    if (!hasField(checker, type, field.name.text, fieldType)) {
      return lacks(meeting, `a field '${field.name.text}: ${typeText(fieldType)}'`);
    }
  }
  return functionWitnesses(meeting, depth);
}

/** A constraint being met by a type at a use site, for reporting why it isn't. */
interface Meeting {
  readonly site: UseSite;
  readonly type: Type;
  readonly constraint: Constraint;
}

/** Reports that the type lacks `missing` to meet the constraint. */
function lacks({ site, type, constraint }: Meeting, missing: string): Failure {
  const trait = constraint.trait.name.text;
  site.report(checkerDiagnostics.notConforming(site.at, typeText(type), trait, missing));
  return 'failed';
}

/** The witness of every function the constraint requires. */
function functionWitnesses(meeting: Meeting, depth: number): readonly ResolvedCall[] | Failure {
  const { site, type, constraint } = meeting;
  const substitution = constraintSubstitution(constraint, type);
  const witnesses: ResolvedCall[] = [];
  for (const declaration of requiredFunctions(constraint.trait)) {
    const required = { declaration, substitution };
    const witness = depth < maximumDepth ? witnessOf(site, type, required, depth) : 'endless';
    switch (witness) {
      case 'none':
        return lacks(
          meeting,
          `'${declaration.name.text}' as ${constraint.trait.name.text} declares it`,
        );
      case 'endless': {
        const trait = constraint.trait.name.text;
        site.report(checkerDiagnostics.endlessConformance(site.at, typeText(type), trait));
        return 'endless';
      }
      case 'failed':
        return 'failed';
      default:
        witnesses.push(witness);
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
 * The call meeting `required` for `type`: `none` when no single function does; otherwise, when
 * the one that does can't be instantiated or called (calls-made.ts), the failure reported.
 */
function witnessOf(
  site: UseSite,
  type: Type,
  required: RequiredFunction,
  depth: number,
): ResolvedCall | 'none' | Failure {
  const { checker } = site;
  const signature = signatureOf(checker, required.declaration, required.substitution);
  const parameterTypes = signature.parameters.map((parameter) => parameter.type);
  const candidates = witnessCandidates(site, type, required.declaration, parameterTypes);
  const callArguments = signature.parameters.map(
    ({ type: each, reference }): CallArgument => ({
      type: each,
      passing: reference ? 'reference' : 'value',
      exact: true,
    }),
  );
  const choice = choose(checker, candidates, callArguments, undefined);
  if (choice.kind !== 'chosen') {
    return 'none';
  }
  const { application } = choice;
  const instantiation = instantiateAt(silent(site), application, signature.result(), depth + 1);
  if (isFailure(instantiation)) {
    return instantiation === 'endless' ? 'endless' : 'none';
  }
  const result = substitute(application.signature.result(), instantiation.substitution);
  if (!sameType(result, signature.result())) {
    return 'none';
  }
  const arity = callArguments.length;
  return callMade(application.candidate, instantiation, arity);
}

function hasField(checker: CheckerContext, type: Type, name: string, fieldType: Type): boolean {
  if (type.kind === 'nominal') {
    return (checker.fieldsOf(type) ?? []).some(
      (field) => field.name === name && sameType(field.type, fieldType),
    );
  }
  if (type.kind === 'parameter' && type.declaration.kind === 'TypeParameter') {
    return checker
      .constraintsOf(type.declaration)
      .some((constraint) =>
        requiredFields(constraint.trait).some(
          (field) =>
            field.name.text === name &&
            sameType(requiredFieldType(checker, constraint, field, type), fieldType),
        ),
      );
  }
  return false;
}

function substituteConstraint(constraint: Constraint, substitution: Substitution): Constraint {
  return {
    trait: constraint.trait,
    arguments: constraint.arguments.map((argument) => substitute(argument, substitution)),
  };
}

/** Which way `trait` says a type crosses as JSON, for the derived `Encodable` and `Decodable`. */
function jsonMarkerDirection(
  checker: CheckerContext,
  trait: TraitDeclaration,
): JsonDirection | undefined {
  return (Object.keys(jsonMarkers) as JsonDirection[]).find((direction) =>
    isWellKnownTrait(checker, trait, jsonMarkers[direction]),
  );
}
