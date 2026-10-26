/**
 * Choosing the function a call means among its candidates (§3.7): calls are resolved from the
 * arguments alone, never from the result.
 *
 * - A candidate applies when it takes as many arguments as given, counting parameters with
 *   defaults as optional (§3.3), each argument passed by value or by `&` as its parameter is
 *   declared, and every argument fits its parameter. A method's receiver takes its `&` implicitly,
 *   so it is passed either way, whichever its `self` asks for. A reference names the caller's own
 *   variable, so its type must be the parameter's exactly, with no implicit wrap (§3.7). A generic candidate's type parameters are
 *   inferred from the arguments meanwhile (inference/infer.ts); written type arguments are taken
 *   as given (§3.5).
 * - When concrete candidates apply, only they are chosen among: a concrete function beats a
 *   generic one (§3.7). Written type arguments consider only generic candidates. Any other tie is
 *   ambiguous.
 * - An argument whose type the chosen function decides (`none`, a bare variant) takes part with
 *   no type: it fits a parameter of a type it can take (an optional, an enum with that variant),
 *   or one of a type parameter still to be inferred.
 *
 * `inapplicability` is the one rule: choosing keeps the candidates it finds nothing against, and a
 * report about a failed call explains the reason it found.
 */

import type { FunctionDeclaration, TypeParameter } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { Inference } from '../inference/infer.ts';
import { typeParametersOf } from '../types/resolve-type.ts';
import {
  type ParameterKey,
  type Substitution,
  sameType,
  substitute,
  type Type,
} from '../types/type.ts';
import type { Candidate } from './candidates.ts';

/**
 * What a candidate takes and gives, with a requirement's trait mapped (traits/constraints.ts).
 * Choosing never looks at results (§3.7), and a result may only be known by checking a body, so
 * `result` is computed only when asked, for the function chosen.
 */
export interface Signature {
  readonly declaration: FunctionDeclaration;
  readonly typeParameters: readonly TypeParameter[];
  readonly parameters: readonly SignatureSlot[];
  readonly result: () => Type;
}

interface SignatureSlot {
  readonly type: Type;
  readonly reference: boolean;
  readonly hasDefault: boolean;
}

/**
 * How an argument is passed: as a value, by `&`, or as a method's receiver, which its `self`
 * takes either way (§3.7).
 */
export type Passing = 'value' | 'reference' | 'receiver';

/**
 * An argument as choosing sees it: its type, or, when the chosen function decides it, which
 * parameter types it can take; and how it is passed.
 */
export interface CallArgument {
  readonly type: Type | undefined;
  readonly passing: Passing;
  readonly accepts?: ((expected: Type) => boolean) | undefined;
}

/** A candidate that applies, with what inference has found for its type parameters so far. */
export interface Application {
  readonly candidate: Candidate;
  readonly signature: Signature;
  readonly inference: Inference;
}

/** Why a candidate can't take a call's arguments. */
export type Inapplicability =
  | { readonly kind: 'arity'; readonly minimum: number; readonly maximum: number }
  | { readonly kind: 'typeArgumentCount'; readonly minimum: number; readonly maximum: number }
  /** The argument at `index` is passed by value where its parameter takes `&` (`reference`), or the reverse. */
  | { readonly kind: 'reference'; readonly index: number; readonly reference: boolean }
  /** Two arguments gave one type parameter types that don't agree (§3.5). */
  | { readonly kind: 'conflict'; readonly parameter: TypeParameter }
  /** The arguments that don't fit their parameters, by position, with the parameter's type. */
  | {
      readonly kind: 'arguments';
      readonly misfits: readonly { readonly index: number; readonly expected: Type }[];
    };

export type Choice =
  | { readonly kind: 'chosen'; readonly application: Application }
  | { readonly kind: 'none'; readonly reasons: readonly Inapplicability[] }
  | { readonly kind: 'several' };

/** The signature of `declaration`, with a requirement's trait mapped by `substitution`. */
export function signatureOf(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
  substitution: Substitution = new Map(),
): Signature {
  return {
    declaration,
    typeParameters: typeParametersOf(declaration.typeParameters),
    parameters: checker.parametersOf(declaration).map((parameter) => ({
      type: substitute(parameter.type, substitution),
      reference: parameter.reference,
      hasDefault: parameter.node.defaultValue !== undefined,
    })),
    result: () => substitute(checker.resultOf(declaration), substitution),
  };
}

/** Chooses among `candidates` for `callArguments` and any written type arguments. */
export function choose(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  callArguments: readonly CallArgument[],
  written: readonly Type[] | undefined,
): Choice {
  const applications: Application[] = [];
  const reasons: Inapplicability[] = [];
  for (const candidate of candidates) {
    const outcome = applicationOf(checker, candidate, callArguments, written);
    if ('inference' in outcome) {
      applications.push(outcome);
    } else {
      reasons.push(outcome);
    }
  }
  const concrete = applications.filter(({ signature }) => signature.typeParameters.length === 0);
  const preferred = concrete.length > 0 ? concrete : applications;
  const [only] = preferred;
  if (preferred.length === 1 && only !== undefined) {
    return { kind: 'chosen', application: only };
  }
  return preferred.length === 0 ? { kind: 'none', reasons } : { kind: 'several' };
}

/** Why `candidate` can't take `callArguments`, or how it takes them. */
function applicationOf(
  checker: CheckerContext,
  candidate: Candidate,
  callArguments: readonly CallArgument[],
  written: readonly Type[] | undefined,
): Application | Inapplicability {
  const signature = signatureOf(
    checker,
    candidate.declaration,
    candidate.requirement?.substitution,
  );
  const taken = takenBy(checker, signature, callArguments, written);
  return 'inference' in taken ? { candidate, signature, inference: taken.inference } : taken;
}

/** What `takenBy` matches: a signature's type parameters and parameters. */
export type Takes = Pick<Signature, 'typeParameters' | 'parameters'>;

/**
 * How a function taking `takes` takes `callArguments` and any written type arguments: what
 * inference found matching them, or why it can't. A function value's call (closures/
 * closures/value-calls.ts) is judged here too, as a signature with no type parameters.
 */
export function takenBy(
  checker: CheckerContext,
  takes: Takes,
  callArguments: readonly CallArgument[],
  written: readonly Type[] | undefined,
): { readonly inference: Inference } | Inapplicability {
  const counted = countInapplicability(takes, callArguments, written);
  if (counted !== undefined) {
    return counted;
  }
  const known = new Map<ParameterKey, Type>();
  for (const [index, type] of (written ?? []).entries()) {
    const parameter = takes.typeParameters[index];
    if (parameter !== undefined) {
      known.set(parameter, type);
    }
  }
  const inference = new Inference(takes.typeParameters, checker.optionalEntity, known);
  return argumentsInapplicability(takes, callArguments, inference) ?? { inference };
}

/** Why the counts of written type arguments or of arguments don't suit `signature`, if they don't. */
function countInapplicability(
  { typeParameters, parameters }: Takes,
  callArguments: readonly CallArgument[],
  written: readonly Type[] | undefined,
): Inapplicability | undefined {
  if (written !== undefined) {
    const minimum = typeParameters.filter(
      (parameter) => parameter.defaultType === undefined,
    ).length;
    const maximum = typeParameters.length;
    if (maximum === 0 || written.length < minimum || written.length > maximum) {
      return { kind: 'typeArgumentCount', minimum, maximum };
    }
  }
  const minimum = parameters.filter((parameter) => !parameter.hasDefault).length;
  return callArguments.length < minimum || callArguments.length > parameters.length
    ? { kind: 'arity', minimum, maximum: parameters.length }
    : undefined;
}

/**
 * Why the arguments don't fit `signature`'s parameters, matching them for inference meanwhile.
 * Arguments with types are matched first, in any order, so what inference finds doesn't depend on
 * where an argument the chosen function decides stands; those are judged against what was found.
 */
function argumentsInapplicability(
  { parameters }: Takes,
  callArguments: readonly CallArgument[],
  inference: Inference,
): Inapplicability | undefined {
  const indexed = [...callArguments.entries()];
  const typedFirst = [
    ...indexed.filter(([, argument]) => argument.type !== undefined),
    ...indexed.filter(([, argument]) => argument.type === undefined),
  ];
  const misfits: { index: number; expected: Type }[] = [];
  for (const [index, argument] of typedFirst) {
    // The arity was checked first, so every argument has its parameter.
    const slot = parameters[index] as SignatureSlot;
    if (argument.passing !== 'receiver' && slot.reference !== (argument.passing === 'reference')) {
      return { kind: 'reference', index, reference: slot.reference };
    }
    const conflicts = inference.conflicts.size;
    const fits =
      argument.type === undefined
        ? acceptsDecided(argument, slot.type, inference)
        : inference.match(slot.type, argument.type) &&
          exactWhenReferenced(slot, argument, inference);
    const [conflict] = [...inference.conflicts].slice(conflicts);
    if (conflict?.kind === 'TypeParameter') {
      return { kind: 'conflict', parameter: conflict };
    }
    if (!fits) {
      misfits.push({ index, expected: substitute(slot.type, inference.substitution()) });
    }
  }
  return misfits.length === 0 ? undefined : { kind: 'arguments', misfits };
}

/** A reference's type is its parameter's exactly: no wrap into `T?` reaches the caller's place. */
function exactWhenReferenced(
  slot: SignatureSlot,
  argument: CallArgument,
  inference: Inference,
): boolean {
  if (!isByReference(slot, argument) || argument.type === undefined) {
    return true;
  }
  return sameType(substitute(slot.type, inference.substitution()), argument.type);
}

/** Whether `argument` reaches `slot` by reference: written `&`, or a receiver `&self` takes (§3.7). */
function isByReference(slot: SignatureSlot, argument: CallArgument): boolean {
  return argument.passing === 'reference' || (argument.passing === 'receiver' && slot.reference);
}

/** Whether an argument the chosen function decides can take a parameter of type `declared`. */
function acceptsDecided(argument: CallArgument, declared: Type, inference: Inference): boolean {
  const parameter = substitute(declared, inference.substitution());
  const isOpen = parameter.kind === 'parameter' && inference.isUnknown(parameter.declaration);
  return isOpen || (argument.accepts?.(parameter) ?? true);
}
