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
 * - A required field is met by a struct field of the same name and type, or by a constraint on a
 *   type parameter requiring it too.
 * - A trait the compiler derives (derived-traits.ts) asks what its rule asks of every type first,
 *   and a required function no function is declared for is met by the witness it derives.
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
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type Completion, completeInference } from '../inference/complete.ts';
import type { ResolvedCall, Witnesses } from '../resolved-call.ts';
import {
  constraintSubstitution,
  fieldOf,
  requiredFields,
  requiredFieldType,
  requiredFunctions,
  substituteConstraint,
} from '../traits/constraints.ts';
import { sameType } from '../types/identity.ts';
import { type Substitution, substitute } from '../types/substitution.ts';
import { type Constraint, errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import type { UseSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import { type Application, signatureOf } from './choice.ts';
import { chooseWitness } from './declared-witness.ts';
import { type Derivation, derivationOf } from './derived-traits.ts';

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
    const met: (readonly ResolvedCall[])[] = [];
    for (const constraint of site.checker.constraintsOf(parameter)) {
      const mapped = substituteConstraint(constraint, substitution);
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

/** What searching for a constraint's witnesses found, distinguishing an undeclared function from a failure. */
export type ConformanceOutcome =
  | { readonly kind: 'met'; readonly witnesses: readonly ResolvedCall[] }
  | { readonly kind: 'undeclared' }
  | { readonly kind: 'failed' };

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
  const derivation = derivationOf(site.checker, constraint.trait);
  const missing = derivation?.lacking(site, type) ?? missingField(meeting);
  if (missing !== undefined) {
    return lacks(meeting, missing);
  }
  return functionWitnesses(meeting, depth, unmet ?? derivedOrMissing(meeting, derivation));
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
  site.report((at) => checkerDiagnostics.notConforming(at, typeText(type), trait, missing));
  return 'failed';
}

/** The first field the constraint requires that the type lacks, said as it lacks it. */
function missingField({ site, type, constraint }: Meeting): string | undefined {
  for (const field of requiredFields(constraint.trait)) {
    const fieldType = requiredFieldType(site.checker, constraint, field, type);
    if (!hasField(site.checker, type, field.name.text, fieldType)) {
      return `a field '${field.name.text}: ${typeText(fieldType)}'`;
    }
  }
  return undefined;
}

/**
 * What meets a required function no function is declared for: the witness `derivation` derives
 * for the type, or else nothing, reported as what the type lacks to have one, by default the
 * function itself.
 */
function derivedOrMissing(
  meeting: Meeting,
  derivation: Derivation | undefined,
): (declaration: FunctionDeclaration) => ResolvedCall | Failure {
  const { site, type, constraint } = meeting;
  return (declaration) => {
    const derived = derivation?.derive?.(site, type);
    if (derived?.kind === 'derived') {
      return derived.call;
    }
    const required = `'${declaration.name.text}' as ${constraint.trait.name.text} declares it`;
    return lacks(meeting, derived?.missing ?? required);
  };
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

/**
 * What searching for a single required function's witness found: the call, nothing declared
 * (`none`), several candidates tying (`ambiguous`), a declared function giving another result
 * (`wrongResult`), or a declared function whose own instantiation failed (`failed` / `endless`).
 */
type WitnessOutcome =
  | { readonly kind: 'call'; readonly call: ResolvedCall }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'wrongResult'; readonly required: Type; readonly given: Type }
  | { readonly kind: 'failed' }
  | { readonly kind: 'endless' };

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
  const { checker } = site;
  const signature = signatureOf(checker, required.declaration, required.substitution);
  const choice = chooseWitness(checker, type, signature);
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
  const result = substitute(application.signature.result(), instantiation.substitution);
  if (!sameType(result, signature.result())) {
    return { kind: 'wrongResult', required: signature.result(), given: result };
  }
  return { kind: 'call', call: callMade(application, instantiation) };
}

function hasField(checker: CheckerContext, type: Type, name: string, fieldType: Type): boolean {
  const field = fieldOf(checker, type, name);
  return field !== undefined && sameType(field.member.type, fieldType);
}
