/**
 * How a call's arguments fill its function's parameters (§3.3): the one rule a written call, a
 * call the language makes, a witness and a function named as a value are all bound by, so choosing
 * (choice.ts), overload clashes (rules/clashes.ts) and lowering agree on which argument a parameter
 * takes.
 *
 * - Positional arguments fill the parameters in order; once they run past the fixed ones, or from
 *   the first spread on, the rest parameter collects them, spreads included. A spread with no rest
 *   parameter to collect it, or a positional argument past the last parameter, doesn't fit.
 * - A named argument fills the parameter of its name, the rest parameter taking a whole array. A
 *   method's `self` has no name to give (§3.7), and a parameter can be given only once.
 * - Every parameter left out takes its default; one without a default makes the call not fit, and
 *   a rest parameter nothing fills is empty.
 * - A function named as a value is bound as its type calls it (`bindValue`): by position, its rest
 *   parameter one array, its trailing parameters left to their defaults (§3.14).
 */

import { type Binding, parameterOfArgument } from '../resolved-call.ts';
import type { Type } from '../types/type.ts';

/** What binding needs to know of a parameter: its name, if it can be named, and its kind. */
export interface BoundSlot {
  readonly name?: string | undefined;
  readonly hasDefault: boolean;
  readonly isRest: boolean;
}

/** What binding needs to know of an argument: its name, when named, and whether it spreads. */
export interface BoundArgument {
  readonly name?: string | undefined;
  readonly isSpread?: boolean | undefined;
}

/** Why arguments can't fill a function's parameters. */
export type BindingFailure =
  /** Too many arguments by position, or too few with every argument by position. */
  | { readonly kind: 'arity'; readonly minimum: number; readonly maximum: number }
  /** A named argument names no parameter. */
  | { readonly kind: 'unnamed'; readonly name: string }
  /** A parameter is given twice, by position and by name, or twice by name. */
  | { readonly kind: 'twice'; readonly name: string }
  /** A parameter without a default is given no argument. */
  | { readonly kind: 'missing'; readonly name: string }
  /** A spread with no rest parameter to collect it. */
  | { readonly kind: 'spread' };

/** How arguments are bound: as a call passes them, or as a function value's type does. */
export type Binder = (
  slots: readonly BoundSlot[],
  callArguments: readonly BoundArgument[],
) => Binding | BindingFailure;

/** How many arguments a call may pass `slots` by position: one per fixed parameter without a default, up to all, or any number into a rest parameter. */
export function positionalCounts(slots: readonly BoundSlot[]): {
  readonly minimum: number;
  readonly maximum: number;
} {
  const fixed = slots.filter((slot) => !slot.isRest);
  return {
    minimum: fixed.filter((slot) => !slot.hasDefault).length,
    maximum: fixed.length < slots.length ? Number.POSITIVE_INFINITY : fixed.length,
  };
}

/** The binding of `callArguments` to `slots` as a call passes them, or why they don't fit. */
export const bindArguments: Binder = (slots, callArguments) => {
  const numbered = callArguments.map((argument, index) => ({ argument, index }));
  const positional = numbered.filter(({ argument }) => argument.name === undefined);
  const named = numbered.flatMap(({ argument, index }) =>
    argument.name === undefined ? [] : [{ name: argument.name, index }],
  );
  const byPosition = bindByPosition(slots, positional);
  if (isFailure(byPosition)) {
    return byPosition;
  }
  const byName = bindByName(slots, byPosition, named);
  return isFailure(byName) ? byName : filled(slots, byName, named.length > 0);
};

/** Whether `bound` is why binding failed, rather than what it found. */
function isFailure(bound: Sources | BindingFailure): bound is BindingFailure {
  return !Array.isArray(bound);
}

/** The binding of a function value's arguments, all by position, its rest parameter one array. */
export const bindValue: Binder = (slots, callArguments) =>
  callArguments.length > slots.length
    ? arityOf(slots)
    : filled(
        slots,
        slots.map((_, index) =>
          index < callArguments.length ? { kind: 'argument', index } : undefined,
        ),
        false,
      );

/** A source not yet found for a parameter. */
type Sources = readonly (Binding[number] | undefined)[];

/**
 * The parameters `positional` fill: the fixed ones in order until the arguments run past them or
 * a spread starts, the rest parameter every argument from there on.
 */
function bindByPosition(
  slots: readonly BoundSlot[],
  positional: readonly { readonly argument: BoundArgument; readonly index: number }[],
): Sources | BindingFailure {
  const restIndex = slots.findIndex((slot) => slot.isRest);
  const fixed = restIndex === -1 ? slots.length : restIndex;
  const spread = positional.findIndex(({ argument }) => argument.isSpread === true);
  const toFixed = positional.slice(0, Math.min(fixed, spread === -1 ? fixed : spread));
  const toRest = positional.slice(toFixed.length);
  if (restIndex === -1 && toRest.length > 0) {
    return spread === -1 ? arityOf(slots) : { kind: 'spread' };
  }
  return slots.map((_, parameter) => {
    const given = toFixed[parameter];
    if (given !== undefined) {
      return { kind: 'argument', index: given.index };
    }
    return parameter === restIndex && toRest.length > 0
      ? { kind: 'rest', items: toRest.map(({ index }) => index) }
      : undefined;
  });
}

/** `sources` with each of `named` filling the parameter of its name, which nothing else may fill. */
function bindByName(
  slots: readonly BoundSlot[],
  sources: Sources,
  named: readonly { readonly name: string; readonly index: number }[],
): Sources | BindingFailure {
  const bound = [...sources];
  for (const { name, index } of named) {
    const parameter = slots.findIndex((slot) => slot.name === name);
    if (parameter === -1) {
      return { kind: 'unnamed', name };
    }
    if (bound[parameter] !== undefined) {
      return { kind: 'twice', name };
    }
    bound[parameter] = { kind: 'argument', index };
  }
  return bound;
}

/**
 * `sources`, every parameter still unfilled taking its default, a rest parameter an empty array,
 * or why one can't.
 */
function filled(
  slots: readonly BoundSlot[],
  sources: Sources,
  isNamed: boolean,
): Binding | BindingFailure {
  const binding: Binding[number][] = [];
  for (const [index, slot] of slots.entries()) {
    const source = sources[index] ?? unfilled(slot);
    if (source === undefined) {
      return isNamed && slot.name !== undefined
        ? { kind: 'missing', name: slot.name }
        : arityOf(slots);
    }
    binding.push(source);
  }
  return binding;
}

/** What a parameter no argument fills takes: its default, or an empty rest; nothing otherwise. */
function unfilled(slot: BoundSlot): Binding[number] | undefined {
  if (slot.isRest) {
    return { kind: 'rest', items: [] };
  }
  return slot.hasDefault ? { kind: 'default' } : undefined;
}

function arityOf(slots: readonly BoundSlot[]): BindingFailure {
  return { kind: 'arity', ...positionalCounts(slots) };
}

/** What an argument fills: a parameter's type and passing, or, as a rest parameter's item, its array's element, by value. */
export interface ArgumentSlot {
  readonly type: Type;
  readonly reference: boolean;
}

/** By argument number, the slot `binding` passes each argument to. */
export function argumentSlotsOf(
  slots: readonly (ArgumentSlot & { readonly item?: Type | undefined })[],
  binding: Binding,
): ReadonlyMap<number, ArgumentSlot> {
  return new Map(
    [...parameterOfArgument(binding)].flatMap(([argument, parameter]) => {
      const slot = slots[parameter];
      if (binding[parameter]?.kind !== 'rest') {
        return slot === undefined ? [] : [[argument, slot] as const];
      }
      const item = slot?.item;
      return item === undefined ? [] : [[argument, { type: item, reference: false }] as const];
    }),
  );
}

/** Whether `bound` is a binding, not why one failed. */
export function isBinding(bound: Binding | BindingFailure): bound is Binding {
  return Array.isArray(bound);
}
