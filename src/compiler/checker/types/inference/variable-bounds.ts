/**
 * What one variable of an inference is bounded by (design.md §4), as the bound store holds it
 * (bounds.ts): the bounds and the role each plays, and what reading them tells — which only
 * advise, which come from a consumer, which parameters they mention. Inference and settling read
 * these without the store.
 */

import { memo } from '../../../../foundation/structures/memo.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import type { CallVariables } from './variables.ts';

/**
 * What a bound says beside its type (design.md §4): whether it only advises, the expected type's,
 * set aside where it disagrees; and which construct's match made it, if one did. Whether it comes
 * from what consumes its variable's construct, which settling's rule 2 may choose, is read against
 * the variable holding it (`fromConsumer`), so a bound handed from one variable to another
 * (`BoundStore.relate`) reads as the other's.
 */
export interface BoundRole {
  readonly advice: boolean;
  readonly by: CallVariables | undefined;
}

/** Whether `bound` only advises: the expected type's, set aside where it disagrees. */
export function isAdvice(bound: BoundRole): boolean {
  return bound.advice;
}

/**
 * Whether `bound`, of a variable of `call`, is what takes that construct's value: the expected
 * type's, or one another construct's match made, as an enclosing call's parameter.
 */
export function fromConsumer(bound: BoundRole, call: CallVariables | undefined): boolean {
  return bound.advice || (bound.by !== undefined && bound.by !== call);
}

/** A type a parameter's argument must be at least; `fresh` when a written literal gave it. */
export interface LowerBound {
  readonly type: Type;
  readonly fresh: boolean;
  /** Whether it is a struct literal's shape, which a struct its fields give takes (§5.2). */
  readonly isShape: boolean;
  readonly advice: boolean;
  readonly by: CallVariables | undefined;
  /**
   * Whether it bounds its own variable alone, never one related to it: an item of a collection
   * literal whose items agree on no one type, which settles on what it goes into (design.md §4).
   */
  readonly isApart?: boolean | undefined;
}

/** A type a parameter's argument must be at most, or exactly. */
export interface Bound extends BoundRole {
  readonly type: Type;
}

/** What one parameter is bound by. */
export interface VariableBounds {
  readonly equal: Bound | undefined;
  readonly lower: readonly LowerBound[];
  readonly upper: readonly Bound[];
}

/** The variables one is related to (`BoundStore.relate`): those below it, and those above it. */
export interface Related {
  readonly below: readonly ParameterKey[];
  readonly above: readonly ParameterKey[];
}

/** Whether `bound` is a struct literal's shape, which a struct it settles to may take (§5.2). */
export function isShape(bound: Bound | LowerBound): boolean {
  return 'isShape' in bound && bound.isShape;
}

/** `bounds` without the expected type's advice. */
export function requirementsOf(bounds: VariableBounds): VariableBounds {
  const isRequired = (bound: Bound) => !isAdvice(bound);
  return {
    equal: bounds.equal !== undefined && isRequired(bounds.equal) ? bounds.equal : undefined,
    lower: bounds.lower.filter(isRequired),
    upper: bounds.upper.filter(isRequired),
  };
}

/** The parameters `bounds` mention. */
export function mentionedBy(bounds: VariableBounds): readonly ParameterKey[] {
  return memo(mentions, bounds, () => {
    const { equal, lower, upper } = bounds;
    return [...(equal === undefined ? [] : [equal]), ...lower, ...upper].flatMap(({ type }) =>
      parametersIn(type),
    );
  });
}

/** What `mentionedBy` found, by the bounds it read: a store's bounds are replaced, never changed. */
const mentions = new WeakMap<VariableBounds, readonly ParameterKey[]>();
