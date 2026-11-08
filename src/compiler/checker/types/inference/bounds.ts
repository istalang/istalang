/**
 * The bounds an inference has found for each type parameter it is finding (§3.5): types its
 * argument must be at least (lower), at most (upper), or exactly (equal). Matching adds them
 * (infer.ts); settling reads them in a fixed order (settle.ts).
 *
 * - A bound comes from the call's arguments, or from the type the call is expected to give, which
 *   only advises: a bound from the arguments is checked against the arguments' bounds alone, so an
 *   expected type never makes a call inapplicable, while one from the expected type is checked
 *   against every bound, so matching it fails where it disagrees and leaves nothing behind.
 * - Bounds disagreeing is a conflict: a lower bound no equality or upper bound takes, an equality
 *   another differs from, or lower bounds with no common type. A bound mentioning a type parameter
 *   still to be found is checked once settling has substituted it.
 * - A literal written as an argument gives its literal type, fresh: settling widens it to its base
 *   unless an upper bound holds a literal type of that base (§2).
 * - Two variables related, one bounding the other (`relate`), hand each other their bounds: the
 *   lower one's lower bounds are the upper one's, and the upper one's upper bounds the lower one's,
 *   now and as they are added (design.md §4).
 * - Matching probes: every change is undone past a mark when a probe fails (`rollback`), so a probe
 *   that fails leaves no bound behind.
 */

import type { ParameterKey, Type } from '../type/index.ts';

/** Where a bound came from: the call's arguments, or its expected type, which only advises. */
type Origin = 'argument' | 'expected';

/** A type a parameter's argument must be at least; `fresh` when a written literal gave it. */
export interface LowerBound {
  readonly type: Type;
  readonly fresh: boolean;
  readonly origin: Origin;
}

/** A type a parameter's argument must be at most, or exactly. */
export interface Bound {
  readonly type: Type;
  readonly origin: Origin;
}

/** What one parameter is bound by. */
export interface VariableBounds {
  readonly equal: Bound | undefined;
  readonly lower: readonly LowerBound[];
  readonly upper: readonly Bound[];
}

/** What checking bounds against each other needs. */
export interface BoundRules {
  /** Whether a value of `found` fits where `expected` is. */
  readonly fits: (found: Type, expected: Type) => boolean;
  /** Whether `first` and `second` are the same type. */
  readonly same: (first: Type, second: Type) => boolean;
  /** Whether `type` mentions a parameter still to be found. */
  readonly isOpen: (type: Type) => boolean;
  /**
   * The type `lower` bounds of `parameter` join to, its fresh literals widened unless an `upper`
   * bound holds a literal of their base; undefined when they have none.
   */
  readonly join: (
    parameter: ParameterKey,
    lower: readonly LowerBound[],
    upper: readonly Bound[],
  ) => Type | undefined;
}

const noBounds: VariableBounds = { equal: undefined, lower: [], upper: [] };

export class BoundStore {
  readonly #rules: BoundRules;
  readonly #bounds = new Map<ParameterKey, VariableBounds>();
  /** For each variable, those it is bounded below by (`relate`), and those it bounds above. */
  readonly #below = new Map<ParameterKey, readonly ParameterKey[]>();
  readonly #above = new Map<ParameterKey, readonly ParameterKey[]>();
  /** How to undo each change, newest last. */
  readonly #undo: (() => void)[] = [];

  constructor(rules: BoundRules) {
    this.#rules = rules;
  }

  /**
   * Takes on `other`'s bounds and relations, as a system does those of the calls joining it
   * (system.ts); their variables are apart from this store's own.
   */
  adopt(other: BoundStore): void {
    copyInto(other.#bounds, this.#bounds);
    copyInto(other.#below, this.#below);
    copyInto(other.#above, this.#above);
  }

  /** What `parameter` is bound by so far. */
  of(parameter: ParameterKey): VariableBounds {
    return this.#bounds.get(parameter) ?? noBounds;
  }

  /** A point to roll back to. */
  mark(): number {
    return this.#undo.length;
  }

  /** Undoes every change made since `mark`. */
  rollback(mark: number): void {
    while (this.#undo.length > mark) {
      this.#undo.pop()?.();
    }
  }

  /**
   * Bounds `upper` below by `lower`, both variables: each lower bound of `lower`, now and later,
   * is one of `upper` too, and each upper bound of `upper` one of `lower`, so an expected type
   * reaches a variable through another; false when those disagree.
   */
  relate(lower: ParameterKey, upper: ParameterKey): boolean {
    if (lower === upper || (this.#above.get(lower) ?? []).includes(upper)) {
      return true;
    }
    this.#link(this.#above, lower, upper);
    this.#link(this.#below, upper, lower);
    return (
      this.of(lower).lower.every((bound) => this.addLower(upper, bound)) &&
      this.of(upper).upper.every((bound) => this.addUpper(lower, bound))
    );
  }

  /** Adds a lower bound; false when it disagrees with the bounds it is checked against. */
  addLower(parameter: ParameterKey, bound: LowerBound): boolean {
    const bounds = this.of(parameter);
    if (bounds.lower.some((each) => this.#isSame(each, bound))) {
      return true;
    }
    const checked = checkedAgainst(bounds, bound.origin);
    const lower = [...bounds.lower, bound];
    const agrees =
      this.#takes(checked.equal, bound.type) &&
      checked.upper.every((upper) => this.#fitsUnlessOpen(bound.type, upper.type)) &&
      this.#joins(parameter, checkedAgainst({ ...bounds, lower }, bound.origin));
    if (agrees) {
      this.#set(parameter, { ...bounds, lower });
    }
    return (
      agrees && (this.#above.get(parameter) ?? []).every((upper) => this.addLower(upper, bound))
    );
  }

  /** Adds an upper bound; false when it disagrees with the bounds it is checked against. */
  addUpper(parameter: ParameterKey, bound: Bound): boolean {
    const bounds = this.of(parameter);
    if (bounds.upper.some((each) => this.#isSame(each, bound))) {
      return true;
    }
    const checked = checkedAgainst(bounds, bound.origin);
    const agrees =
      (checked.equal === undefined || this.#fitsUnlessOpen(checked.equal.type, bound.type)) &&
      checked.lower.every((lower) => this.#fitsUnlessOpen(lower.type, bound.type));
    if (agrees) {
      this.#set(parameter, { ...bounds, upper: [...bounds.upper, bound] });
    }
    return (
      agrees && (this.#below.get(parameter) ?? []).every((lower) => this.addUpper(lower, bound))
    );
  }

  /** Whether two bounds are the same: of one type and one origin. */
  #isSame(first: Bound, second: Bound): boolean {
    return first.origin === second.origin && this.#rules.same(first.type, second.type);
  }

  /** Links `to` after `from` in `links`, undone on rollback. */
  #link(
    links: Map<ParameterKey, readonly ParameterKey[]>,
    from: ParameterKey,
    to: ParameterKey,
  ): void {
    const before = links.get(from);
    links.set(from, [...(before ?? []), to]);
    this.#undo.push(() => {
      if (before === undefined) {
        links.delete(from);
      } else {
        links.set(from, before);
      }
    });
  }

  /** Adds an equality; false when it disagrees with the bounds it is checked against. */
  addEqual(parameter: ParameterKey, bound: Bound): boolean {
    const bounds = this.of(parameter);
    const checked = checkedAgainst(bounds, bound.origin);
    const { equal } = checked;
    if (equal !== undefined) {
      return this.#rules.isOpen(equal.type) || this.#rules.same(equal.type, bound.type);
    }
    const agrees =
      checked.lower.every((lower) => this.#fitsUnlessOpen(lower.type, bound.type)) &&
      checked.upper.every((upper) => this.#fitsUnlessOpen(bound.type, upper.type));
    if (agrees) {
      this.#set(parameter, { ...bounds, equal: bound });
    }
    return agrees;
  }

  /** Whether an equality, if any, takes a value of `type`. */
  #takes(equal: Bound | undefined, type: Type): boolean {
    return equal === undefined || this.#fitsUnlessOpen(type, equal.type);
  }

  #fitsUnlessOpen(found: Type, expected: Type): boolean {
    const { isOpen, fits } = this.#rules;
    return isOpen(found) || isOpen(expected) || fits(found, expected);
  }

  /** Whether the lower bounds of `bounds`, those mentioning no parameter still to be found, join. */
  #joins(parameter: ParameterKey, { lower, upper }: VariableBounds): boolean {
    const closed = lower.filter((bound) => !this.#rules.isOpen(bound.type));
    return closed.length === 0 || this.#rules.join(parameter, closed, upper) !== undefined;
  }

  #set(parameter: ParameterKey, bounds: VariableBounds): void {
    const before = this.#bounds.get(parameter);
    this.#bounds.set(parameter, bounds);
    this.#undo.push(() => {
      if (before === undefined) {
        this.#bounds.delete(parameter);
      } else {
        this.#bounds.set(parameter, before);
      }
    });
  }
}

/** Copies each of `from`'s entries into `to`. */
function copyInto<Value>(
  from: ReadonlyMap<ParameterKey, Value>,
  to: Map<ParameterKey, Value>,
): void {
  for (const [variable, value] of from) {
    to.set(variable, value);
  }
}

/**
 * The bounds a bound of `origin` is checked against: the arguments' alone for an argument's, every
 * bound for the expected type's.
 */
function checkedAgainst(bounds: VariableBounds, origin: Origin): VariableBounds {
  return origin === 'expected' ? bounds : fromArguments(bounds);
}

/** `bounds` without the expected type's. */
export function fromArguments(bounds: VariableBounds): VariableBounds {
  const fromThem = ({ origin }: Bound) => origin === 'argument';
  return {
    equal: bounds.equal?.origin === 'argument' ? bounds.equal : undefined,
    lower: bounds.lower.filter(fromThem),
    upper: bounds.upper.filter(fromThem),
  };
}
