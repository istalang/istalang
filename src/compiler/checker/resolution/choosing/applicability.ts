/**
 * Whether a candidate applies to a call (§3.3, §3.5, §3.7): how a function takes the arguments,
 * which parameter each fills and what inference finds matching them, or why it can't.
 *
 * - The parameters must take the arguments given (binding.ts), each argument passed by value or by
 *   `&` as its parameter is declared, and every argument must fit its parameter. A method's
 *   receiver takes its `&` implicitly, so it is passed either way, whichever its `self` asks for. A
 *   reference names the caller's own variable, so its type must be the parameter's exactly, with no
 *   implicit wrap (§3.7). A generic function's type parameters are inferred from the arguments
 *   meanwhile (types/inference/infer.ts); written type arguments are taken as given (§3.5).
 * - A rest parameter's items, and a spread's items, are matched against its array's element type.
 *   A pack's (§3.5) are matched together against the pack: single values as the tuple of their
 *   types, or one spread of a value of a pack as that pack, exactly.
 * - A literal written in place has its literal type where its parameter expects one (§2), so it
 *   fits a parameter of a union of literals, and fills a member parameter (§3.5).
 * - An argument whose type the chosen function decides (`none`, a bare variant, a literal holding
 *   one) takes part with no type: it fits a parameter of a type it can take (an optional, an enum
 *   with that variant), any part of which may be a type parameter still to be inferred.
 */

import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { isImplicitKind } from '../../../syntax/declarations/function-kinds.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Binding } from '../../surface/resolved-call.ts';
import { reshapes } from '../../types/fitting/fit/index.ts';
import { Inference } from '../../types/inference/infer.ts';
import { isPlaceholder } from '../../types/inference/variables.ts';
import type { Substitution } from '../../types/parts/substitution.ts';
import { fillsPack } from '../../types/type/function-types.ts';
import type { ParameterSlot, Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { argumentSlotsOf, type Binder, isBinding } from './binding.ts';
import type { CallArgument, Inapplicability, Misfit, Takes } from './call-arguments.ts';
import { packInapplicability, packItems } from './packs.ts';

/**
 * A call's arguments as choosing takes them: as passed, with any type arguments, bound by `binder`.
 */
export interface Given {
  readonly callArguments: readonly CallArgument[];
  readonly written: readonly Type[] | undefined;
  readonly binder: Binder;
  /** The call's own site, which its variables stand at (types/inference/variables.ts). */
  readonly site?: object | undefined;
  /** The constraint scope's inference each candidate's system starts as a copy of. */
  readonly scope?: Inference | undefined;
  /**
   * The kind a callee's implicit kind parameter is decided to before inferring (proposal 8, Rule
   * 3): the kind a function value's expected type fixes, a kind or either; or, for a call, the
   * kind of its code, the only one the call rule lets it take there. Where that code is generic
   * over its kind, a callee's kind a future reads is left to inference and settling instead
   * (kind-settling.ts), since an argument's future may fix it first (`retry(fetchLive)`).
   */
  readonly decidedKind?: Type | undefined;
}

/**
 * How a function takes a call's arguments: what inference found, the binding, and by argument
 * number the slot each argument fills (a pack's arguments fill it together, so have none).
 */
export interface Taken {
  readonly inference: Inference;
  readonly binding: Binding;
  readonly slots: ReadonlyMap<number, ParameterSlot>;
}

/**
 * How a function taking `takes` takes `callArguments` and any written type arguments: which
 * parameter each argument fills and what inference found matching them, or why it can't. A function
 * value's call (constructs/closures/value-calls.ts) is judged here too, as a signature with no type
 * parameters.
 */
export function takenBy(
  checker: CheckerContext,
  takes: Takes,
  { callArguments, written, binder, site, scope, decidedKind }: Given,
): Taken | Inapplicability {
  const counted = typeArgumentsInapplicability(takes, written);
  if (counted !== undefined) {
    return counted;
  }
  const binding = binder(takes.parameters, callArguments);
  if (!isBinding(binding)) {
    return binding;
  }
  const inference = new Inference(
    takes.typeParameters,
    checker.fitting,
    decidedFor(takes, written, decidedKind),
    { site, copying: scope },
  );
  const slots = argumentSlotsOf(takes.parameters, binding);
  const packed = packItems(takes, binding);
  const matchPacks = () => packInapplicability(takes, binding, callArguments, inference);
  const misfit = argumentsInapplicability(callArguments, { slots, packed, matchPacks }, inference);
  return misfit ?? { inference, binding, slots };
}

/**
 * Whether `taken` takes an argument only reshaped: a plain function made async (§3.14), a lambda
 * the call decides by the type its written parameters make it among them, converted between a
 * one-element tuple and its element (§3.15) or part by part (§3.5), or a `struct{…}` built as a
 * struct rather than its own shape (§3.1). Choosing asks it only to break a tie, so it isn't part
 * of `Taken`.
 */
export function reshapesArguments(
  checker: Pick<CheckerContext, 'fitOf'>,
  { inference, slots }: Taken,
  callArguments: readonly CallArgument[],
): boolean {
  return callArguments.some((argument, index) => {
    const slot = slots.get(index);
    // What the scope still infers is what its bounds tell so far, as a lambda's written parameters.
    const type = argument.type === undefined ? undefined : inference.tentativeIn(argument.type);
    if (type === undefined || slot === undefined) {
      return false;
    }
    const fit = checker.fitOf(type, inference.substituted(slot.type));
    // A `struct{…}`'s shape fitting no parameter builds the struct it is passed as (§3.1).
    return fit === undefined ? type.kind === 'anonymous' : reshapes(fit);
  });
}

/** The type arguments `written` gives `takes`' type parameters, in order (§3.5). */
export function writtenFor(
  { typeParameters }: Takes,
  written: readonly Type[] | undefined,
): Substitution | undefined {
  if (written === undefined) {
    return undefined;
  }
  const writable = typeParameters.filter((parameter) => !isImplicitKind(parameter));
  return new Map(
    written.flatMap((type, index) => {
      const parameter = writable[index];
      return parameter === undefined ? [] : [[parameter, type] as const];
    }),
  );
}

/**
 * What is decided of `takes`' type parameters before inferring: what is written, and the implicit
 * kind a function value's expected type fixes.
 */
function decidedFor(
  takes: Takes,
  written: readonly Type[] | undefined,
  decidedKind: Type | undefined,
): Substitution | undefined {
  const writtenArguments = writtenFor(takes, written);
  const kinds = takes.typeParameters.filter(
    (parameter) =>
      isImplicitKind(parameter) &&
      (decidedKind?.kind !== 'parameter' || parameter.memberOf === undefined),
  );
  return decidedKind === undefined || kinds.length === 0
    ? writtenArguments
    : new Map([...(writtenArguments ?? []), ...kinds.map((each) => [each, decidedKind] as const)]);
}

/**
 * Why the written type arguments don't suit `typeParameters`, if they don't: too few or too many,
 * or one for a pack that isn't a tuple type (§3.5).
 */
export function typeArgumentsInapplicability(
  { typeParameters }: Takes,
  written: readonly Type[] | undefined,
): Inapplicability | undefined {
  if (written === undefined) {
    return undefined;
  }
  // A function's kind parameter is never written (syntax/declarations/function-kinds.ts).
  const writable = typeParameters.filter((parameter) => !isImplicitKind(parameter));
  const minimum = writable.filter((parameter) => parameter.defaultType === undefined).length;
  const maximum = writable.length;
  if (maximum === 0 || written.length < minimum || written.length > maximum) {
    return { kind: 'typeArgumentCount', minimum, maximum };
  }
  const misfit = writable.findIndex(
    (each, index) => each.isPack && !fillsPack(written[index] ?? errorType),
  );
  const [pack, type] = [writable[misfit], written[misfit]];
  return pack === undefined || type === undefined
    ? undefined
    : { kind: 'packTypeArgument', parameter: pack, type };
}

/**
 * By argument number, the slot each argument fills, and the arguments a pack takes together, which
 * `matchPacks` matches, saying why they don't fill it.
 */
interface BoundArguments {
  readonly slots: ReadonlyMap<number, ParameterSlot>;
  readonly packed: ReadonlySet<number>;
  readonly matchPacks: () => Inapplicability | undefined;
}

/**
 * Why the arguments don't fit `signature`'s parameters, matching them for inference meanwhile.
 * Arguments with types of their own are matched first, in any order, so what inference finds
 * doesn't depend on where a placeholder stands; then a pack's, which take what those found; and
 * last the placeholders of what the call's scope checks once it knows what is expected of it
 * (wiring/body/constraint-scope.ts), each refusing a parameter it can't be a value of.
 */
function argumentsInapplicability(
  callArguments: readonly CallArgument[],
  bound: BoundArguments,
  inference: Inference,
): Inapplicability | undefined {
  const misfits: Misfit[] = [];
  /** Judges the arguments a pack doesn't take that `isJudged` picks. */
  const judged = (isJudged: (argument: CallArgument) => boolean): Inapplicability | undefined => {
    // Indexed rather than over `entries()`: this runs for every argument of every candidate.
    for (let index = 0; index < callArguments.length; index += 1) {
      const argument = callArguments[index];
      const judgement =
        argument !== undefined && !bound.packed.has(index) && isJudged(argument)
          ? judgedArgument(index, argument, bound.slots, inference)
          : undefined;
      if (judgement !== undefined && judgement !== 'fits') {
        if ('kind' in judgement) {
          return judgement;
        }
        misfits.push(judgement);
      }
    }
    return undefined;
  };
  const refused =
    judged((argument) => !isPlaceholder(argument.type)) ??
    bound.matchPacks() ??
    judged((argument) => isPlaceholder(argument.type));
  if (refused !== undefined) {
    return refused;
  }
  return misfits.length === 0 ? undefined : { kind: 'arguments', misfits };
}

/** How the `index`-th argument fits its slot: it fits, it doesn't, or the call can't take it. */
function judgedArgument(
  index: number,
  argument: CallArgument,
  slots: ReadonlyMap<number, ParameterSlot>,
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
  const severalMembers = inference.severalMembers.size;
  const fits = argument.type === undefined || typedFits(slot, argument, argument.type, inference);
  const conflict = addedBy(inference.conflicts, conflicts);
  if (conflict?.kind === 'TypeParameter') {
    return { kind: 'conflict', parameter: conflict };
  }
  const several = addedBy(inference.severalMembers, severalMembers);
  if (several !== undefined && several[0].kind === 'TypeParameter') {
    return { kind: 'severalMembers', index, parameter: several[0], found: several[1] };
  }
  return fits ? 'fits' : { index, expected: inference.substituted(slot.type) };
}

/**
 * Whether an argument with a type fits `slot`, matching it for inference. A reference's type is
 * its parameter's exactly, as an exact argument's is: no wrap into `T?` reaches the caller's place.
 * A method's receiver gives the type parameters it meets as they are, by reference exactly where
 * `&self` takes it (types/inference/infer.ts `matchReceiver`). A written literal is matched as
 * one, its literal type fresh (§2); a literal of items fits a parameter its type converts into
 * (§3.5).
 */
function typedFits(
  slot: ParameterSlot,
  argument: CallArgument,
  type: Type,
  inference: Inference,
): boolean {
  if (argument.passing === 'receiver') {
    return inference.matchReceiver(slot.type, type, slot.reference);
  }
  if (argument.exact === true || argument.passing === 'reference') {
    return inference.matchExactly(slot.type, type);
  }
  return argument.literal === undefined
    ? inference.match(slot.type, type)
    : inference.matchLiteral(slot.type, argument.literal);
}

/**
 * The first item `collection` gained past its first `size`, as matching one argument added it;
 * collections keep insertion order. Most matches add none, so that case reads no item.
 */
function addedBy<Item>(
  collection: Iterable<Item> & { readonly size: number },
  size: number,
): Item | undefined {
  return collection.size > size ? [...collection][size] : undefined;
}
