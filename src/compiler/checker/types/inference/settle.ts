/**
 * Settling (§3.5): the type each parameter an inference is finding takes from its bounds
 * (bounds.ts), by one policy, in order:
 *
 * 1. an equality;
 * 2. inside the result only, the expected type's choice: an upper bound it gave that every lower
 *    bound fits, the parameter admits and every other upper bound takes, so a value is built at the
 *    type it goes to (`pair(1, 2)` as an `Array<Int?>` settles `Int?`). At the result's top, where
 *    the call's value converts, it has no say: `biggest(a, b)` as an `Int?` settles `Int`;
 * 3. the common type of the lower bounds (types/unions/common-type.ts), which every upper bound
 *    takes;
 * 4. an upper bound every lower bound fits and every other upper bound takes, a written union among
 *    them (`pick("draft", "sent")` as a `Status`); one its constraints refuse is still the only
 *    type left, so the refusal is reported rather than nothing inferred;
 * 5. its default;
 * 6. else nothing: the error type where it met one, a mistake reported already, `Never` where only
 *    it met one, and otherwise it can't be inferred.
 *
 * The expected type only advises: where its bounds leave a parameter no type by 1–4, the parameter
 * is settled without them, and the call's value is judged against the expected type as any value
 * is. A parameter whose bounds mention another still to be found is settled after it, its bounds
 * read with what is settled; those mentioning each other are settled in the order declared.
 */

import { noSubstitution, type Substitution, substitute } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { errorType } from '../type/primitives.ts';
import type { TypeRules } from '../type/type-rules.ts';
import {
  type Bound,
  fromConsumer,
  isAdvice,
  isShape,
  type LowerBound,
  mentionedBy,
  type Related,
  requirementsOf,
  type VariableBounds,
} from './variable-bounds.ts';
import type { CallVariables } from './variables.ts';

/** What settling asks of the program for a parameter. */
export interface Settling {
  /** Whether `type` may stand for `parameter`: its constraints met (§3.5). */
  readonly admits: (parameter: ParameterKey, type: Type) => boolean;
  /** `parameter`'s default, with what is settled so far, if it has one. */
  readonly defaultOf: (parameter: ParameterKey, settled: Substitution) => Type | undefined;
}

/**
 * How the variables of no call, or a construct with no type parameters, settle: by their bounds.
 */
export const settlesFreely: Settling = { admits: () => true, defaultOf: () => undefined };

/** What settling reads of an inference. */
export interface SettlingView {
  readonly rules: TypeRules;
  readonly boundsOf: (parameter: ParameterKey) => VariableBounds;
  /** Whether `parameter` stands at the top of the result: the result itself, or a member of it. */
  readonly isAtTop: (parameter: ParameterKey) => boolean;
  /** The call `parameter` is one of the variables of, which its bounds are read against. */
  readonly callOf: (parameter: ParameterKey) => CallVariables | undefined;
  readonly fits: (found: Type, expected: Type) => boolean;
  /** Whether `target`, a struct its fields give, takes a struct literal of shape `shape` (§3.1). */
  readonly takesShape: (target: Type, shape: Type) => boolean;
  readonly join: (
    parameter: ParameterKey,
    lower: readonly LowerBound[],
    upper: readonly Bound[],
  ) => Type | undefined;
  /** What a parameter no bound settles falls back to: the error type or `Never` it met. */
  readonly fallbackOf: (parameter: ParameterKey) => Type | undefined;
  /** The parameters `parameter` is bounded below by, and those it bounds above (bounds.ts). */
  readonly relatedOf: (parameter: ParameterKey) => Related;
}

/**
 * `parameters` settled, `given` taken as it is; a parameter left out can't be inferred (rule 6).
 * A type given that mentions others of `parameters`, as a placeholder's (i2-scope.md §3), is taken
 * once they are settled, with what they settled to.
 */
export function settleAll(
  parameters: readonly ParameterKey[],
  given: Substitution,
  view: SettlingView,
  settling: Settling,
): Map<ParameterKey, Type> {
  const settled = new Map<ParameterKey, Type>();
  const inSystem = new Set(parameters);
  const mentionsOthers = (type: Type) => parametersIn(type).some((other) => inSystem.has(other));
  for (const parameter of parameters) {
    const type = given.get(parameter);
    if (type !== undefined && !mentionsOthers(type)) {
      settled.set(parameter, type);
    }
  }
  // What later variables' bounds read: the settled ones, and the error type for one that couldn't
  // be, so no variable is left in what another settles to; it alone stays out of `settled`.
  const closing = new Map(settled);
  // In order, so ties go to the first.
  const pending = new Set(parameters.filter((parameter) => !settled.has(parameter)));
  for (let parameter = nextToSettle(pending, view, given); parameter !== undefined; ) {
    pending.delete(parameter);
    const taken = given.get(parameter);
    const type =
      taken === undefined
        ? settleOne(parameter, closing, view, settling)
        : substitute(taken, closing, view.rules);
    closing.set(parameter, type ?? errorType);
    if (type !== undefined) {
      settled.set(parameter, type);
    }
    parameter = nextToSettle(pending, view, given);
  }
  return settled;
}

/**
 * Which of `pending` settles next: the first whose bounds mention nothing pending and which either
 * is related to nothing pending or has bounds of its own; else the first whose bounds mention
 * nothing pending; else the first. A variable related to another (`U <: T`) and bounded only
 * through it thus settles after it, so `outer(empty(), 1)` settles `T` by `1` and then `U` by `T`.
 */
function nextToSettle(
  pending: ReadonlySet<ParameterKey>,
  view: SettlingView,
  given: Substitution,
): ParameterKey | undefined {
  const isPending = (other: ParameterKey, candidate: ParameterKey) =>
    other !== candidate && pending.has(other);
  const waitsOn = (candidate: ParameterKey) => {
    const taken = given.get(candidate);
    return taken === undefined ? mentionedBy(view.boundsOf(candidate)) : parametersIn(taken);
  };
  const closed = (candidate: ParameterKey) =>
    !waitsOn(candidate).some((other) => isPending(other, candidate));
  // A variable settles after those below it with bounds of their own (`ownBoundedBelow`); one with
  // none settles from what those it is related to settled to.
  const ready = (candidate: ParameterKey) =>
    closed(candidate) &&
    (given.has(candidate) ||
      ((hasOwnBounds(view.boundsOf(candidate)) ||
        !relatives(view.relatedOf(candidate)).some((other) => isPending(other, candidate))) &&
        !ownBoundedBelow(candidate, view).some((other) => isPending(other, candidate))));
  return firstOf(pending, ready) ?? firstOf(pending, closed) ?? firstOf(pending, () => true);
}

/** The first of `items`, in order, that `passes`. */
function firstOf<Item>(items: Iterable<Item>, passes: (item: Item) => boolean): Item | undefined {
  for (const item of items) {
    if (passes(item)) {
      return item;
    }
  }
  return undefined;
}

/** Whether `bounds` hold any bound at all. */
export function hasBounds({ equal, lower, upper }: VariableBounds): boolean {
  return equal !== undefined || lower.length > 0 || upper.length > 0;
}

/**
 * Whether `bounds` hold a bound of their variable's own, which a variable above it waits for it to
 * settle by: any but an item apart's (variable-bounds.ts), which bounds nothing settling reads
 * first, its variable settling from above.
 */
function hasOwnBounds(bounds: VariableBounds): boolean {
  return hasBounds({ ...bounds, lower: bounds.lower.filter(({ isApart }) => isApart !== true) });
}

/**
 * The variables below `parameter` with bounds of their own, which it settles after, as they hand it
 * what they settle to.
 */
function ownBoundedBelow(
  parameter: ParameterKey,
  view: Pick<SettlingView, 'boundsOf' | 'relatedOf'>,
): readonly ParameterKey[] {
  return view.relatedOf(parameter).below.filter((other) => hasOwnBounds(view.boundsOf(other)));
}

/**
 * What settling `parameter` waits on (`settleAll`): the variables its bounds mention, and those
 * below it with bounds of their own (`ownBoundedBelow`).
 */
export function waitedOn(
  parameter: ParameterKey,
  view: Pick<SettlingView, 'boundsOf' | 'relatedOf'>,
): readonly ParameterKey[] {
  return [...mentionedBy(view.boundsOf(parameter)), ...ownBoundedBelow(parameter, view)];
}

/** The type `parameter` settles to, its bounds read with `settled`; undefined when none. */
export function settleOne(
  parameter: ParameterKey,
  settled: Substitution,
  view: SettlingView,
  settling: Settling,
): Type | undefined {
  const related = withRelatives(
    closedBounds(view.boundsOf(parameter), settled, view.rules),
    view.relatedOf(parameter),
    { settled, callOf: view.callOf },
  );
  // Items apart (variable-bounds.ts) settle on what takes them where something does, judged there
  // after.
  const isTaken = related.equal !== undefined || related.upper.length > 0;
  const bounds = isTaken
    ? { ...related, lower: related.lower.filter(({ isApart }) => isApart !== true) }
    : related;
  // An equality the expected type advises is rule 2's to choose, as an upper bound.
  const decide = (of: VariableBounds) =>
    (of.equal === undefined || isAdvice(of.equal) ? undefined : of.equal.type) ??
    (view.isAtTop(parameter) ? undefined : expectedChoice(parameter, of, view, settling)) ??
    lowerJoin(parameter, of, view) ??
    upperChoice(of, view);
  return (
    decide(bounds) ??
    decide(requirementsOf(bounds)) ??
    settledBelow(parameter, bounds, view, settled) ??
    settling.defaultOf(parameter, settled) ??
    view.fallbackOf(parameter)
  );
}

/**
 * What the variables `parameter` is related to from below settled to, joined, where that takes
 * every bound of its own: as what they settled to stands for the bounds they handed it, a branch's
 * result variable its producers', `[(k1, 1), (k2, 2)]`'s items' agreeing on `(String, Int)`.
 */
function settledBelow(
  parameter: ParameterKey,
  bounds: VariableBounds,
  view: SettlingView,
  settled: Substitution,
): Type | undefined {
  const below = view.relatedOf(parameter).below.flatMap((key) => settled.get(key) ?? []);
  const lower = below.map((type) => ({
    type,
    fresh: false,
    isShape: false,
    advice: false,
    by: undefined,
  }));
  const joined = lower.length === 0 ? undefined : view.join(parameter, lower, bounds.upper);
  return joined !== undefined &&
    bounds.lower.every(({ type }) => view.fits(type, joined)) &&
    bounds.upper.every(({ type }) => view.fits(joined, type))
    ? joined
    : undefined;
}

/**
 * Rule 2 alone for `parameter`, its bounds read with `settled`: what a postponed argument's result
 * is expected to be (constructs/expressions/postponed.ts); undefined at the result's top.
 */
export function expectedChoiceOf(
  parameter: ParameterKey,
  settled: Substitution,
  view: SettlingView,
  settling: Settling,
): Type | undefined {
  if (view.isAtTop(parameter)) {
    return undefined;
  }
  const bounds = closedBounds(view.boundsOf(parameter), settled, view.rules);
  return expectedChoice(parameter, bounds, view, settling);
}

/**
 * Rule 2: an upper bound of what consumes the variable's value, the expected type's or an
 * enclosing construct's, where it agrees with every other bound.
 */
function expectedChoice(
  parameter: ParameterKey,
  bounds: VariableBounds,
  view: SettlingView,
  settling: Settling,
): Type | undefined {
  // An invariant position gives the expected type as an equality, which chooses as an upper bound.
  const given = bounds.equal === undefined ? bounds.upper : [bounds.equal, ...bounds.upper];
  const call = view.callOf(parameter);
  return given
    .filter((bound) => fromConsumer(bound, call))
    .find(
      (candidate) =>
        agreesWith(candidate.type, bounds, view) && settling.admits(parameter, candidate.type),
    )?.type;
}

/** Rule 3: the lower bounds' common type, where every upper bound takes it. */
function lowerJoin(
  parameter: ParameterKey,
  { lower, upper }: VariableBounds,
  view: SettlingView,
): Type | undefined {
  if (lower.length === 0) {
    return undefined;
  }
  const joined = view.join(parameter, lower, upper);
  return joined !== undefined && upper.every((bound) => view.fits(joined, bound.type))
    ? joined
    : undefined;
}

/** Rule 4: an upper bound every other bound agrees with. */
function upperChoice(bounds: VariableBounds, view: SettlingView): Type | undefined {
  return bounds.upper.find((candidate) => agreesWith(candidate.type, bounds, view))?.type;
}

/** Whether every lower bound fits `candidate`, and every upper bound takes it. */
function agreesWith(
  candidate: Type,
  { lower, upper }: VariableBounds,
  view: SettlingView,
): boolean {
  return (
    lower.every(
      (bound) =>
        view.fits(bound.type, candidate) ||
        (isShape(bound) && view.takesShape(candidate, bound.type)),
    ) && upper.every((bound) => view.fits(candidate, bound.type))
  );
}

/** `bounds` with what is `settled` substituted into each. */
function closedBounds(
  bounds: VariableBounds,
  settled: Substitution,
  rules: TypeRules,
): VariableBounds {
  if (settled === noSubstitution || settled.size === 0) {
    return bounds;
  }
  const closed = <Each extends Bound>(bound: Each): Each => ({
    ...bound,
    type: substitute(bound.type, settled, rules),
  });
  return {
    equal: bounds.equal === undefined ? undefined : closed(bounds.equal),
    lower: bounds.lower.map(closed),
    upper: bounds.upper.map(closed),
  };
}

/**
 * `bounds` with what the parameters related to it settled to, so one bounded only by another, as a
 * call's parameter type passed where a joined call's is (design.md §4), settles from it: a related
 * parameter below gives a lower bound, one above an upper bound, made by its own call, so one of
 * another call's is what consumes it.
 */
function withRelatives(
  bounds: VariableBounds,
  { below, above }: Related,
  { settled, callOf }: Pick<SettlingView, 'callOf'> & { readonly settled: Substitution },
): VariableBounds {
  // One that couldn't be settled hands nothing on: the error type would silence what disagrees.
  const settledOf = (keys: readonly ParameterKey[]) =>
    keys.flatMap((key) => {
      const type = settled.get(key);
      return type === undefined || type.kind === 'error'
        ? []
        : [{ type, advice: false, by: callOf(key) }];
    });
  return {
    ...bounds,
    lower: [
      ...bounds.lower,
      ...settledOf(below).map((bound) => ({ ...bound, fresh: false, isShape: false })),
    ],
    upper: [...bounds.upper, ...settledOf(above)],
  };
}

/** The parameters `related` names. */
function relatives({ below, above }: Related): readonly ParameterKey[] {
  return [...below, ...above];
}

/** How each variable settles: as its call's parameter does, or freely (`settlesFreely`). */
export type SettlingOf = (variable: ParameterKey) => Settling;
