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
import type { TypeRules } from '../type/type-rules.ts';
import { type Bound, fromArguments, type LowerBound, type VariableBounds } from './bounds.ts';

/** What settling asks of the program for a parameter. */
export interface Settling {
  /** Whether `type` may stand for `parameter`: its constraints met (§3.5). */
  readonly admits: (parameter: ParameterKey, type: Type) => boolean;
  /** `parameter`'s default, with what is settled so far, if it has one. */
  readonly defaultOf: (parameter: ParameterKey, settled: Substitution) => Type | undefined;
}

/** What settling reads of an inference. */
export interface SettlingView {
  readonly rules: TypeRules;
  readonly boundsOf: (parameter: ParameterKey) => VariableBounds;
  /** Whether `parameter` stands at the top of the result: the result itself, or a member of it. */
  readonly isAtTop: (parameter: ParameterKey) => boolean;
  readonly fits: (found: Type, expected: Type) => boolean;
  readonly join: (
    parameter: ParameterKey,
    lower: readonly LowerBound[],
    upper: readonly Bound[],
  ) => Type | undefined;
  /** What a parameter no bound settles falls back to: the error type or `Never` it met. */
  readonly fallbackOf: (parameter: ParameterKey) => Type | undefined;
}

/**
 * `parameters` settled, `given` taken as it is; a parameter left out can't be inferred (rule 6).
 */
export function settleAll(
  parameters: readonly ParameterKey[],
  given: Substitution,
  view: SettlingView,
  settling: Settling,
): Map<ParameterKey, Type> {
  const settled = new Map<ParameterKey, Type>();
  for (const parameter of parameters) {
    const type = given.get(parameter);
    if (type !== undefined) {
      settled.set(parameter, type);
    }
  }
  const pending = parameters.filter((parameter) => !settled.has(parameter));
  while (pending.length > 0) {
    const index = Math.max(
      0,
      pending.findIndex((candidate) =>
        mentioned(view.boundsOf(candidate)).every(
          (other) => other === candidate || !pending.includes(other),
        ),
      ),
    );
    const [parameter] = pending.splice(index, 1);
    if (parameter !== undefined) {
      const type = settleOne(parameter, settled, view, settling);
      if (type !== undefined) {
        settled.set(parameter, type);
      }
    }
  }
  return settled;
}

/** The type `parameter` settles to, its bounds read with `settled`; undefined when none. */
export function settleOne(
  parameter: ParameterKey,
  settled: Substitution,
  view: SettlingView,
  settling: Settling,
): Type | undefined {
  const bounds = closedBounds(view.boundsOf(parameter), settled, view.rules);
  const decide = (of: VariableBounds) =>
    of.equal?.type ??
    (view.isAtTop(parameter) ? undefined : expectedChoice(parameter, of, view, settling)) ??
    lowerJoin(parameter, of, view) ??
    upperChoice(of, view);
  return (
    decide(bounds) ??
    decide(fromArguments(bounds)) ??
    settling.defaultOf(parameter, settled) ??
    view.fallbackOf(parameter)
  );
}

/**
 * Rule 2 alone for `parameter`, its bounds read with `settled`: what a postponed argument's result
 * is expected to be (resolution/calls/function-arguments.ts); undefined at the result's top.
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

/** Rule 2: the expected type's upper bound, where it agrees with every other bound. */
function expectedChoice(
  parameter: ParameterKey,
  bounds: VariableBounds,
  view: SettlingView,
  settling: Settling,
): Type | undefined {
  const expected = bounds.upper.filter((bound) => bound.origin === 'expected');
  return expected.find(
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
    lower.every((bound) => view.fits(bound.type, candidate)) &&
    upper.every((bound) => view.fits(candidate, bound.type))
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

/** The parameters `bounds` mention. */
function mentioned({ equal, lower, upper }: VariableBounds): readonly ParameterKey[] {
  return [...(equal === undefined ? [] : [equal]), ...lower, ...upper].flatMap(({ type }) =>
    parametersIn(type),
  );
}
