/**
 * Instantiating a chosen function and meeting its constraints (§3.5, §3.10).
 *
 * - A chosen generic function's type parameters that the arguments left open come from the type
 *   the call is expected to have, then from their defaults; one still open can't be inferred.
 * - Every type argument must meet its parameter's constraints. A type meets a trait where it is
 *   met: the functions the trait requires must be visible there, in scope, through argument-
 *   dependent lookup on the type, or as a requirement of a type parameter's own constraints. Each
 *   is found by resolving a call to it with the required parameter types, and must give the
 *   required result. The calls found are the witnesses the instantiation calls (check.ts).
 * - A required field is met by a struct field of the same name and type, or by a constraint on a
 *   type parameter requiring it too. `Sendable` is derived (sendable.ts).
 * - A requirement with type parameters of its own is met by a function generic in the same way:
 *   resolving the call with those parameters as opaque types infers the candidate's own.
 * - A witness search that fails is reported once, as the constraint not met, so searching itself
 *   reports nothing (`UseSite.report`).
 */

import type { FunctionDeclaration, TypeParameter } from '../../syntax/declarations.ts';
import type { ResolvedCall, Witnesses } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { type Completion, completeInference } from '../inference/complete.ts';
import { callMade } from '../overloads/calls-made.ts';
import {
  type Candidate,
  callCandidates,
  namedInModule,
  type StaticTarget,
  staticCandidates,
} from '../overloads/candidates.ts';
import { type Application, choose, signatureOf } from '../overloads/choice.ts';
import { errorType, type Substitution, sameType, substitute, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { silent, type UseSite } from '../use-site.ts';
import {
  type Constraint,
  constraintSubstitution,
  requiredFields,
  requiredFieldType,
  requiredFunctions,
} from './constraints.ts';
import { isSendable, isSendableTrait } from './sendable.ts';

/** A chosen function, complete: its type arguments, and the witnesses of its constraints. */
export interface Instantiation {
  readonly typeArguments: readonly Type[];
  readonly substitution: Substitution;
  readonly witnesses: Witnesses;
}

/** Witness searches may nest; this bounds one that would recurse without end. */
const maximumDepth = 16;

/**
 * Completes `application`: open type parameters from `expected`, then their defaults, then every
 * constraint met. Undefined after reporting at the use site why it can't be.
 */
export function instantiate(
  site: UseSite,
  application: Application,
  expected: Type | undefined,
  depth = 0,
): Instantiation | undefined {
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
    return undefined;
  }
  const { typeArguments, substitution } = completion;
  const witnesses =
    candidate.requirement === undefined
      ? witnessesOf(site, typeParameters, completion, depth)
      : new Map();
  return witnesses === undefined ? undefined : { typeArguments, substitution, witnesses };
}

/** The witnesses of every constraint on `parameters`, given their arguments; undefined after a report. */
function witnessesOf(
  site: UseSite,
  parameters: readonly TypeParameter[],
  { typeArguments, substitution }: Extract<Completion, { kind: 'complete' }>,
  depth: number,
): Witnesses | undefined {
  const witnesses = new Map<TypeParameter, readonly (readonly ResolvedCall[])[]>();
  for (const [index, parameter] of parameters.entries()) {
    const argument = typeArguments[index] ?? errorType;
    const met: (readonly ResolvedCall[])[] = [];
    for (const constraint of site.checker.constraintsOf(parameter)) {
      const mapped = substituteConstraint(constraint, substitution);
      const witnessesOfConstraint = conform(site, argument, mapped, depth);
      if (witnessesOfConstraint === undefined) {
        return undefined;
      }
      met.push(witnessesOfConstraint);
    }
    witnesses.set(parameter, met);
  }
  return witnesses;
}

/** Whether `type` meets `constraint` at the use site, reporting there when it doesn't. */
export function meets(site: UseSite, type: Type, constraint: Constraint): boolean {
  return conform(site, type, constraint, 0) !== undefined;
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
    return callCandidates(checker, namedInModule(checker, module, name), name, parameterTypes);
  }
  const target = staticTargetOf(checker, type);
  return target === undefined ? [] : staticCandidates(checker, module, target, name);
}

/** What static calls through `type` look at; undefined for a type with no static functions. */
export function staticTargetOf(checker: CheckerContext, type: Type): StaticTarget | undefined {
  switch (type.kind) {
    case 'primitive': {
      const { prelude } = checker.program.roles;
      return prelude === undefined
        ? undefined
        : { kind: 'owner', owner: type.name, module: prelude };
    }
    case 'nominal':
      return {
        kind: 'owner',
        owner: type.entity.declaration,
        module: checker.moduleOf(type.entity.declaration),
      };
    case 'parameter':
      return type.declaration.kind === 'TypeParameter'
        ? { kind: 'parameter', parameter: type.declaration }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * The witness of every function `constraint` requires of `type`; undefined after a report. A
 * type already in error was reported, so it fails silently.
 */
function conform(
  site: UseSite,
  type: Type,
  constraint: Constraint,
  depth: number,
): readonly ResolvedCall[] | undefined {
  const { checker, at } = site;
  if (type.kind === 'error') {
    return undefined;
  }
  const fail = (missing: string): undefined => {
    site.report(
      checkerDiagnostics.notConforming(at, typeText(type), constraint.trait.name.text, missing),
    );
  };
  if (isSendableTrait(checker, constraint.trait)) {
    return isSendable(checker, type) ? [] : fail('every value inside it to be sendable');
  }
  const substitution = constraintSubstitution(constraint, type);
  for (const field of requiredFields(constraint.trait)) {
    const fieldType = requiredFieldType(checker, constraint, field, type);
    if (!hasField(checker, type, field.name.text, fieldType)) {
      return fail(`a field '${field.name.text}: ${typeText(fieldType)}'`);
    }
  }
  const witnesses: ResolvedCall[] = [];
  for (const declaration of requiredFunctions(constraint.trait)) {
    const required = { declaration, substitution };
    const witness = depth < maximumDepth ? witnessOf(site, type, required, depth) : 'none';
    if (witness === 'none') {
      return fail(`'${declaration.name.text}' as ${constraint.trait.name.text} declares it`);
    }
    if (witness === 'refused') {
      return undefined;
    }
    witnesses.push(witness);
  }
  return witnesses;
}

/** A function a trait requires, mapped for the type that must meet it. */
interface RequiredFunction {
  readonly declaration: FunctionDeclaration;
  readonly substitution: Substitution;
}

/**
 * The call meeting `required` for `type`: `none` when no single function does, `refused` when
 * the one that does can't be called (calls-made.ts), which was reported at the use site.
 */
function witnessOf(
  site: UseSite,
  type: Type,
  required: RequiredFunction,
  depth: number,
): ResolvedCall | 'none' | 'refused' {
  const { checker } = site;
  const signature = signatureOf(checker, required.declaration, required.substitution);
  const parameterTypes = signature.parameters.map((parameter) => parameter.type);
  const candidates = witnessCandidates(site, type, required.declaration, parameterTypes);
  const callArguments = signature.parameters.map(({ type: each, reference }) => ({
    type: each,
    reference,
  }));
  const choice = choose(checker, candidates, callArguments, undefined);
  if (choice.kind !== 'chosen') {
    return 'none';
  }
  const { application } = choice;
  const instantiation = instantiate(silent(site), application, undefined, depth + 1);
  if (instantiation === undefined) {
    return 'none';
  }
  const result = substitute(application.signature.result(), instantiation.substitution);
  if (!sameType(result, signature.result())) {
    return 'none';
  }
  const arity = callArguments.length;
  return callMade(site, application.candidate, instantiation, arity) ?? 'refused';
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
