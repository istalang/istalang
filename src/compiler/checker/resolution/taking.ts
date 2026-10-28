/**
 * How a function takes a call's arguments (§3.3, §3.5, §3.7): which parameter each fills, and what
 * inference finds matching them, or why it can't.
 *
 * - The parameters must take the arguments given (binding.ts), each argument passed by value or by
 *   `&` as its parameter is declared, and every argument must fit its parameter. A method's
 *   receiver takes its `&` implicitly, so it is passed either way, whichever its `self` asks for. A
 *   reference names the caller's own variable, so its type must be the parameter's exactly, with no
 *   implicit wrap (§3.7). A generic function's type parameters are inferred from the arguments
 *   meanwhile (inference/infer.ts); written type arguments are taken as given (§3.5).
 * - A rest parameter's items, and a spread's items, are matched against its array's element type.
 *   A pack's (§3.5) are matched together against the pack: single values as the tuple of their
 *   types, or one spread of a value of a pack as that pack, exactly.
 * - An argument whose type the chosen function decides (`none`, a bare variant, a literal holding
 *   one) takes part with no type: it fits a parameter of a type it can take (an optional, an enum
 *   with that variant), any part of which may be a type parameter still to be inferred.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { CheckerContext } from '../context.ts';
import { Inference } from '../inference/infer.ts';
import { reshapes } from '../types/fit.ts';
import { substitute } from '../types/substitution.ts';
import { errorType, fillsPack, type ParameterKey, sameType, type Type } from '../types/type.ts';
import { type ArgumentSlot, argumentSlotsOf, type Binder, isBinding } from './binding.ts';
import type { Application, CallArgument, Inapplicability, Signature } from './choice.ts';
import { packInapplicability, packItems } from './packs.ts';

/** A call's arguments as choosing takes them: as passed, with any type arguments, bound by `binder`. */
export interface Given {
  readonly callArguments: readonly CallArgument[];
  readonly written: readonly Type[] | undefined;
  readonly binder: Binder;
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
export interface Misfit {
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
