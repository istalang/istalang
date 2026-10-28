/**
 * Choosing the function a call means among its candidates (§3.7): calls are resolved from the
 * arguments alone, never from the result.
 *
 * - A candidate applies when it can take the arguments (applicability.ts).
 * - When concrete candidates apply, only they are chosen among: a concrete function beats a
 *   generic one (§3.7); then a function without a rest parameter beats one with (§3.3); then one
 *   taking every argument as it is beats one making a plain function async (§3.14) or converting
 *   between a one-element tuple and its element (§3.15), so a pair taking `fn(A)` and
 *   `async fn(A)` keeps each function its own type. Written type arguments
 *   consider only generic candidates. Any other tie is ambiguous.
 *
 * `inapplicability` is the one rule: choosing keeps the candidates it finds nothing against, and a
 * report about a failed call explains the reason it found.
 */

import { wellKnown } from '../../../language/well-known.ts';
import {
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import type { RestKind } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import type { Inference } from '../inference/infer.ts';
import type { Binding } from '../resolved-call.ts';
import { type Substitution, substitute } from '../types/substitution.ts';
import { errorType, type Type } from '../types/type.ts';
import { wellKnownArguments } from '../types/well-known.ts';
import { type Given, type Misfit, takenBy } from './applicability.ts';
import {
  type ArgumentSlot,
  type BindingFailure,
  bindArguments,
  bindValue,
  type RestSlot,
} from './binding.ts';
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

/**
 * A parameter as choosing sees it: its type and passing, its name, unless a method's `self`, which
 * no call names (§3.3), whether it has a default, and whether it is a rest parameter, an array's
 * or a pack's.
 */
interface SignatureSlot extends ArgumentSlot {
  readonly name: string | undefined;
  readonly hasDefault: boolean;
  readonly rest: RestSlot | undefined;
}

/**
 * How an argument is passed: as a value, by `&`, or as a method's receiver, which its `self`
 * takes either way (§3.7).
 */
export type Passing = 'value' | 'reference' | 'receiver';

/**
 * Whether an argument the chosen function decides can take a parameter of type `expected`, where
 * a part `isOpen` says inference hasn't found yet can be anything.
 */
export type Accepts = (expected: Type, isOpen: (part: Type) => boolean) => boolean;

/**
 * An argument as choosing sees it: its type, or, when the chosen function decides it, which
 * parameter types it can take; how it is passed; its name when named; and for a spread, the type
 * of its items.
 */
export interface CallArgument {
  readonly type: Type | undefined;
  readonly passing: Passing;
  readonly accepts?: Accepts | undefined;
  /**
   * Whether it fits only a parameter of its type exactly, with no conversion: a witness's (§3.10),
   * or a spread's items, which are copied or iterated as they are (§3.3).
   */
  readonly exact?: boolean;
  readonly name?: string | undefined;
  readonly isSpread?: boolean | undefined;
}

/**
 * A candidate that applies: which parameter each argument fills, and what inference has found for
 * its type parameters so far.
 */
export interface Application {
  readonly candidate: Candidate;
  readonly signature: Signature;
  readonly inference: Inference;
  readonly binding: Binding;
  /**
   * Whether it takes an argument only reshaped: a plain function made async (§3.14), or converted
   * between a one-element tuple and its element (§3.15).
   */
  readonly reshapes: boolean;
}

/** Why a candidate can't take a call's arguments. */
export type Inapplicability =
  | BindingFailure
  | { readonly kind: 'typeArgumentCount'; readonly minimum: number; readonly maximum: number }
  /** The argument at `index` is passed by value where its parameter takes `&` (`reference`), or the reverse. */
  | { readonly kind: 'reference'; readonly index: number; readonly reference: boolean }
  /** Two arguments gave one type parameter types that don't agree (§3.5). */
  | { readonly kind: 'conflict'; readonly parameter: TypeParameter }
  /**
   * The arguments a pack's rest parameter collects don't fill it (§3.5): `index` is the first, and
   * `found` the tuple of their types when they are single values, which fill no pack of `expected`.
   */
  | {
      readonly kind: 'pack';
      readonly index: number;
      readonly expected: Type;
      readonly found: Type | undefined;
    }
  /** A written type argument for a pack isn't a tuple type (§3.5). */
  | { readonly kind: 'packTypeArgument'; readonly parameter: TypeParameter; readonly type: Type }
  /** The arguments that don't fit their parameters, by position, with the parameter's type. */
  | {
      readonly kind: 'arguments';
      readonly misfits: readonly Misfit[];
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
    parameters: checker.parametersOf(declaration).map(({ node, type, reference, rest }, index) => {
      const substituted = substitute(type, substitution);
      const isSelf = index === 0 && node.name.text === 'self';
      return {
        type: substituted,
        reference,
        name: isSelf ? undefined : node.name.text,
        hasDefault: node.defaultValue !== undefined,
        rest: rest === undefined ? undefined : restSlotOf(checker, rest, substituted),
      };
    }),
    result: () => substitute(checker.resultOf(declaration), substitution),
  };
}

/** A rest parameter of `kind` and type `type` as choosing sees it: an array's has its items' type. */
function restSlotOf(checker: CheckerContext, kind: RestKind, type: Type): RestSlot {
  if (kind === 'pack') {
    return { kind };
  }
  const item = wellKnownArguments(checker, wellKnown.array, type)?.[0] ?? errorType;
  return { kind, item };
}

/** Chooses among `candidates` for `callArguments` and any written type arguments. */
export function choose(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  callArguments: readonly CallArgument[],
  written: readonly Type[] | undefined,
): Choice {
  return chosenAmong(checker, candidates, { callArguments, written, binder: bindArguments });
}

/** Chooses among `candidates` for a function value taking `callArguments` (resolution/binding.ts). */
export function chooseAsValue(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  callArguments: readonly CallArgument[],
): Choice {
  return chosenAmong(checker, candidates, { callArguments, written: undefined, binder: bindValue });
}

function chosenAmong(
  checker: CheckerContext,
  candidates: readonly Candidate[],
  given: Given,
): Choice {
  const applications: Application[] = [];
  const reasons: Inapplicability[] = [];
  for (const candidate of candidates) {
    const outcome = applicationOf(checker, candidate, given);
    if ('inference' in outcome) {
      applications.push(outcome);
    } else {
      reasons.push(outcome);
    }
  }
  const preferred = [
    ({ signature }: Application) => signature.typeParameters.length === 0,
    ({ signature }: Application) => !signature.parameters.some((slot) => slot.rest !== undefined),
    ({ reshapes: reshaped }: Application) => !reshaped,
  ].reduce((chosen, isPreferred) => {
    const kept = chosen.filter(isPreferred);
    return kept.length > 0 ? kept : chosen;
  }, applications);
  const [only] = preferred;
  if (preferred.length === 1 && only !== undefined) {
    return { kind: 'chosen', application: only };
  }
  return preferred.length === 0 ? { kind: 'none', reasons } : { kind: 'several' };
}

/** Why `candidate` can't take the arguments `given`, or how it takes them. */
function applicationOf(
  checker: CheckerContext,
  candidate: Candidate,
  given: Given,
): Application | Inapplicability {
  const signature = signatureOf(
    checker,
    candidate.declaration,
    candidate.requirement?.substitution,
  );
  const taken = takenBy(checker, signature, given);
  return 'inference' in taken ? { candidate, signature, ...taken } : taken;
}
