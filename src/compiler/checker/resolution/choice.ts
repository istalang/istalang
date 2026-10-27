/**
 * Choosing the function a call means among its candidates (§3.7): calls are resolved from the
 * arguments alone, never from the result.
 *
 * - A candidate applies when its parameters can take the arguments given (binding.ts), each
 *   argument passed by value or by `&` as its parameter is
 *   declared, and every argument fits its parameter. A method's receiver takes its `&` implicitly,
 *   so it is passed either way, whichever its `self` asks for. A reference names the caller's own
 *   variable, so its type must be the parameter's exactly, with no implicit wrap (§3.7). A generic candidate's type parameters are
 *   inferred from the arguments meanwhile (inference/infer.ts); written type arguments are taken
 *   as given (§3.5).
 * - When concrete candidates apply, only they are chosen among: a concrete function beats a
 *   generic one (§3.7); then a function without a rest parameter beats one with (§3.3); then one
 *   taking every argument as it is beats one making a plain function async (§3.14) or converting
 *   between a one-element tuple and its element (§3.15), so a pair taking `fn(A)` and
 *   `async fn(A)` keeps each function its own type. Written type arguments
 *   consider only generic candidates. Any other tie is ambiguous.
 * - A rest parameter's items, and a spread's items, are matched against its array's element type.
 *   A pack's (§3.5) are matched together against the pack: single values as the tuple of their
 *   types, or one spread of a value of a pack as that pack, exactly.
 * - An argument whose type the chosen function decides (`none`, a bare variant, a literal holding
 *   one) takes part with no type: it fits a parameter of a type it can take (an optional, an enum
 *   with that variant), any part of which may be a type parameter still to be inferred.
 *
 * `inapplicability` is the one rule: choosing keeps the candidates it finds nothing against, and a
 * report about a failed call explains the reason it found.
 */

import { wellKnown } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import {
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import type { RestKind } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { Inference } from '../inference/infer.ts';
import type { Binding } from '../resolved-call.ts';
import { reshapes } from '../types/fit.ts';
import {
  errorType,
  fillsPack,
  type ParameterKey,
  type Substitution,
  sameType,
  substitute,
  type Type,
} from '../types/type.ts';
import { wellKnownArguments } from '../types/well-known.ts';
import {
  type ArgumentSlot,
  argumentSlotsOf,
  type Binder,
  type BindingFailure,
  bindArguments,
  bindValue,
  isBinding,
  type RestSlot,
} from './binding.ts';
import type { Candidate } from './candidates.ts';
import { packInapplicability, packItems } from './packs.ts';

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

/** A call's arguments as choosing takes them: as passed, with any type arguments, bound by `binder`. */
interface Given {
  readonly callArguments: readonly CallArgument[];
  readonly written: readonly Type[] | undefined;
  readonly binder: Binder;
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

/** What `takenBy` matches: a signature's type parameters and parameters. */
export type Takes = Pick<Signature, 'typeParameters' | 'parameters'>;

/**
 * How a function taking `takes` takes `callArguments` and any written type arguments: which
 * parameter each argument fills and what inference found matching them, or why it can't. A
 * function value's call (closures/value-calls.ts) is judged here too, as a signature with no type
 * parameters.
 */
export function takenBy(
  checker: CheckerContext,
  takes: Takes,
  { callArguments, written, binder }: Given,
): Taken | Inapplicability {
  const counted = typeArgumentsInapplicability(takes, written);
  if (counted !== undefined) {
    return counted;
  }
  const binding = binder(takes.parameters, callArguments);
  if (!isBinding(binding)) {
    return binding;
  }
  const known = new Map<ParameterKey, Type>();
  for (const [index, type] of (written ?? []).entries()) {
    const parameter = takes.typeParameters[index];
    if (parameter !== undefined) {
      known.set(parameter, type);
    }
  }
  const inference = new Inference(takes.typeParameters, checker.fitting, known);
  const slots = argumentSlotsOf(takes.parameters, binding);
  const packed = packItems(takes, binding);
  const matchPacks = () => packInapplicability(takes, binding, callArguments, inference);
  const misfit = argumentsInapplicability(callArguments, { slots, packed, matchPacks }, inference);
  if (misfit !== undefined) {
    return misfit;
  }
  const reshaped = callArguments.some((argument, index) => {
    const slot = slots.get(index);
    if (argument.type === undefined || slot === undefined) {
      return false;
    }
    const expected = substitute(slot.type, inference.substitution());
    const fit = checker.fitOf(argument.type, expected);
    return fit !== undefined && reshapes(fit);
  });
  return { inference, binding, reshapes: reshaped };
}

/** How a function takes a call's arguments: what inference found, the binding, any reshaped. */
type Taken = Pick<Application, 'inference' | 'binding' | 'reshapes'>;

/**
 * Why the written type arguments don't suit `typeParameters`, if they don't: too few or too many,
 * or one for a pack that isn't a tuple type (§3.5).
 */
function typeArgumentsInapplicability(
  { typeParameters }: Takes,
  written: readonly Type[] | undefined,
): Inapplicability | undefined {
  if (written === undefined) {
    return undefined;
  }
  const minimum = typeParameters.filter((parameter) => parameter.defaultType === undefined).length;
  const maximum = typeParameters.length;
  if (maximum === 0 || written.length < minimum || written.length > maximum) {
    return { kind: 'typeArgumentCount', minimum, maximum };
  }
  const misfit = typeParameters.findIndex(
    (each, index) => each.isPack && !fillsPack(written[index] ?? errorType),
  );
  const [pack, type] = [typeParameters[misfit], written[misfit]];
  return pack === undefined || type === undefined
    ? undefined
    : { kind: 'packTypeArgument', parameter: pack, type };
}

/**
 * By argument number, the slot each argument fills, and the arguments a pack takes together, which
 * `matchPacks` matches, saying why they don't fill it.
 */
interface BoundArguments {
  readonly slots: ReadonlyMap<number, ArgumentSlot>;
  readonly packed: ReadonlySet<number>;
  readonly matchPacks: () => Inapplicability | undefined;
}

/**
 * Why the arguments don't fit `signature`'s parameters, matching them for inference meanwhile.
 * Arguments with types are matched first, in any order, so what inference finds doesn't depend on
 * where an argument the chosen function decides stands; then a pack's, which take what those
 * found; and last those the chosen function decides, judged against what was found.
 */
function argumentsInapplicability(
  callArguments: readonly CallArgument[],
  bound: BoundArguments,
  inference: Inference,
): Inapplicability | undefined {
  const single = [...callArguments.entries()].filter(([index]) => !bound.packed.has(index));
  const misfits: Misfit[] = [];
  const judged = (arguments_: typeof single): Inapplicability | undefined => {
    for (const [index, argument] of arguments_) {
      const judgement = judgedArgument(index, argument, bound.slots, inference);
      if (judgement !== 'fits') {
        if ('kind' in judgement) {
          return judgement;
        }
        misfits.push(judgement);
      }
    }
    return undefined;
  };
  const refused =
    judged(single.filter(([, argument]) => argument.type !== undefined)) ??
    bound.matchPacks() ??
    judged(single.filter(([, argument]) => argument.type === undefined));
  if (refused !== undefined) {
    return refused;
  }
  return misfits.length === 0 ? undefined : { kind: 'arguments', misfits };
}

/** An argument that doesn't fit, by position, with its parameter's type as found so far. */
interface Misfit {
  readonly index: number;
  readonly expected: Type;
}

/** How the `index`-th argument fits its slot: it fits, it doesn't, or the call can't take it. */
function judgedArgument(
  index: number,
  argument: CallArgument,
  slots: ReadonlyMap<number, ArgumentSlot>,
  inference: Inference,
): 'fits' | Misfit | Inapplicability {
  const slot = slots.get(index);
  if (slot === undefined) {
    unreachable(`Argument ${index} was bound to no parameter.`);
  }
  if (argument.passing !== 'receiver' && slot.reference !== (argument.passing === 'reference')) {
    return { kind: 'reference', index, reference: slot.reference };
  }
  const conflicts = inference.conflicts.size;
  const fits =
    argument.type === undefined
      ? acceptsDecided(argument, slot.type, inference)
      : typedFits(slot, { ...argument, type: argument.type }, inference);
  const [conflict] = [...inference.conflicts].slice(conflicts);
  if (conflict?.kind === 'TypeParameter') {
    return { kind: 'conflict', parameter: conflict };
  }
  return fits ? 'fits' : { index, expected: substitute(slot.type, inference.substitution()) };
}

/** Whether an argument with a type fits `slot`, matching it for inference. */
function typedFits(
  slot: ArgumentSlot,
  argument: CallArgument & { readonly type: Type },
  inference: Inference,
): boolean {
  if (argument.exact === true) {
    return inference.matchExactly(slot.type, argument.type);
  }
  return (
    inference.match(slot.type, argument.type) && exactWhenReferenced(slot, argument, inference)
  );
}

/** A reference's type is its parameter's exactly: no wrap into `T?` reaches the caller's place. */
function exactWhenReferenced(
  slot: ArgumentSlot,
  argument: CallArgument,
  inference: Inference,
): boolean {
  if (!isByReference(slot, argument) || argument.type === undefined) {
    return true;
  }
  return sameType(substitute(slot.type, inference.substitution()), argument.type);
}

/** Whether `argument` reaches `slot` by reference: written `&`, or a receiver `&self` takes (§3.7). */
function isByReference(slot: ArgumentSlot, argument: CallArgument): boolean {
  return argument.passing === 'reference' || (argument.passing === 'receiver' && slot.reference);
}

/** Whether an argument the chosen function decides can take a parameter of type `declared`. */
function acceptsDecided(argument: CallArgument, declared: Type, inference: Inference): boolean {
  const isOpen = (part: Type) => part.kind === 'parameter' && inference.isUnknown(part.declaration);
  return argument.accepts?.(substitute(declared, inference.substitution()), isOpen) ?? true;
}
