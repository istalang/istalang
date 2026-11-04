/**
 * Choosing the function a call means among its candidates (§3.7): calls are resolved from the
 * arguments alone, never from the result.
 *
 * - A candidate applies when it can take the arguments (applicability.ts).
 * - A function taking a union whole beats a call on it through a trait (§6); among the rest, when
 *   concrete candidates apply, only they are chosen among: a concrete function beats a
 *   generic one (§3.7); then a function without a rest parameter beats one with (§3.3); then one
 *   taking every argument as it is beats one making a plain function async (§3.14) or converting
 *   between a one-element tuple and its element (§3.15), so a pair taking `fn(A)` and
 *   `async fn(A)` keeps each function its own type. Written type arguments
 *   consider only generic candidates. Any other tie is ambiguous.
 *
 * `inapplicability` is the one rule: choosing keeps the candidates it finds nothing against, and a
 * report about a failed call explains the reason it found.
 */

import { receiverParameter } from '../../../language/well-known.ts';
import {
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import type { Inference } from '../inference/infer.ts';
import type { Binding } from '../resolved-call.ts';
import { type Substitution, substitute } from '../types/substitution.ts';
import type { Type } from '../types/type.ts';
import { type Given, takenBy } from './applicability.ts';
import { bindArguments, bindValue } from './binding.ts';
import type { CallArgument, Inapplicability, SignatureSlot } from './call-arguments.ts';
import type { Candidate } from './candidates.ts';
import { membersRequirementOf } from './union-traits.ts';

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

/** What choosing found: one application, none with each candidate's reason, or several tied. */
export type Choice =
  | { readonly kind: 'chosen'; readonly application: Application }
  | { readonly kind: 'none'; readonly reasons: readonly Inapplicability[] }
  | { readonly kind: 'several'; readonly tied: readonly Application[] };

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
      const substituted = substitute(type, substitution, checker.typeRules);
      const isReceiver = index === 0 && node.name.text === receiverParameter;
      return {
        type: substituted,
        reference,
        name: isReceiver ? undefined : node.name.text,
        isReceiver,
        hasDefault: node.defaultValue !== undefined,
        rest:
          rest?.kind === 'array'
            ? { kind: 'array', item: substitute(rest.item, substitution, checker.typeRules) }
            : rest,
      };
    }),
    result: () => substitute(checker.resultOf(declaration), substitution, checker.typeRules),
  };
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
    ({ candidate }: Application) => membersRequirementOf(candidate) === undefined,
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
  return preferred.length === 0 ? { kind: 'none', reasons } : { kind: 'several', tied: preferred };
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
