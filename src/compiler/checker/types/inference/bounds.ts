/**
 * The bounds an inference has found for each type parameter it is finding (§3.5): types its
 * argument must be at least (lower), at most (upper), or exactly (equal). Matching adds them
 * (infer.ts); settling reads them in a fixed order (settle.ts).
 *
 * - A bound comes from the call's arguments, or from the type the call is expected to give, which
 *   only advises: a bound from the arguments is checked against the arguments' bounds alone, so an
 *   expected type never makes a call inapplicable, while one from the expected type is checked
 *   against every bound, so matching it fails where it disagrees and leaves nothing behind.
 * - Bounds disagreeing is a conflict: a lower bound no equality or upper bound takes, or an
 *   equality another differs from. Lower bounds with no common type are no conflict yet: an upper
 *   bound may take them all, as a `Json` one does `1` and `"a"` (settle.ts). Two bounds of which either mentions
 *   a parameter still to be found, as those a joined call's type gives (design.md §4), agree by
 *   bounding what they mention, so `Ok(5)` passed for a `T` expected to be a
 *   `Result<Int?, String>` bounds `Ok`'s own `T` by `Int?`; one mentioning the parameter it bounds
 *   is checked once settling has substituted it.
 * - A literal written as an argument gives its literal type, fresh: settling widens it to its base
 *   unless an upper bound holds a literal type of that base (§2).
 * - Two variables related, one bounding the other (`relate`), hand each other their bounds: the
 *   lower one's lower bounds are the upper one's, and the upper one's upper bounds the lower one's,
 *   an equality each way as both, now and as they are added (design.md §4), so a placeholder under
 *   an invariant parameter (`Item{value: Small}`) is told what the parameter is.
 * - A variable standing for a mark or a sendability (`M in Mark`, `S in Sendability`) has bounds
 *   that agree by its order (types/type/mark-orders.ts), not by fitting: `"simple"` below `"live"`.
 * - A variable may refuse a bound it can't stand under (`admit`): a placeholder's expression can't
 *   be a value of every type (i2-scope.md §3), as a lambda of one parameter can't be a function of
 *   two.
 * - Matching probes: every change is undone past a mark when a probe fails (`rollback`), so a probe
 *   that fails leaves no bound behind.
 */

import type { Admits } from '../fitting/expected.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import type { QualifierOrder } from '../type/mark-orders.ts';
import {
  type Bound,
  type BoundRole,
  isAdvice,
  isShape,
  type LowerBound,
  type Related,
  requirementsOf,
  type VariableBounds,
} from './variable-bounds.ts';

/** What checking bounds against each other needs. */
export interface BoundRules {
  /** Whether a value of `found` fits where `expected` is. */
  readonly fits: (found: Type, expected: Type) => boolean;
  /**
   * The order a variable standing for a mark or a sendability is of, by which its bounds agree
   * instead of by fitting (types/type/mark-orders.ts).
   */
  readonly orderOf: (parameter: ParameterKey) => QualifierOrder | undefined;
  /** Whether `target`, a struct its fields give, takes a struct literal of shape `shape` (§3.1). */
  readonly takesShape: (target: Type, shape: Type) => boolean;
  /** Whether `first` and `second` are the same type. */
  readonly same: (first: Type, second: Type) => boolean;
  /** Whether `type` mentions a parameter still to be found. */
  readonly isOpen: (type: Type) => boolean;
  /**
   * Whether a value of `found` fits `expected`, either mentioning a parameter still to be found,
   * bounding what they mention as a match of `relating`'s role would; undoing what it bound when
   * not.
   */
  readonly constrain: (found: Type, expected: Type, relating: BoundRole) => boolean;
  /** Whether `first` and `second` are the same type, equating what either mentions likewise. */
  readonly equate: (first: Type, second: Type, relating: BoundRole) => boolean;
  /**
   * Whether a struct literal of `shape` builds `target`, a struct (§3.1), its fields bounding what
   * either mentions as `constrain` does.
   */
  readonly constrainShape: (target: Type, shape: Type, relating: BoundRole) => boolean;
}

const noBounds: VariableBounds = { equal: undefined, lower: [], upper: [] };

/** How deep relating bounds that mention parameters goes before it leaves them to settling. */
const maximumDepth = 16;

export class BoundStore {
  readonly #rules: BoundRules;
  readonly #bounds = new Map<ParameterKey, VariableBounds>();
  /** For each variable, those it is bounded below by (`relate`), and those it bounds above. */
  readonly #below = new Map<ParameterKey, readonly ParameterKey[]>();
  readonly #above = new Map<ParameterKey, readonly ParameterKey[]>();
  /** What each variable that refuses some bounds may stand under (`admit`). */
  readonly #admitting = new Map<ParameterKey, Admits>();
  /** How to undo each change, newest last. */
  readonly #undo: (() => void)[] = [];
  /** Counts every change, undoing included, so what is read of the store is memoized by it. */
  #revision = 0;
  /** How many bounds deep the check being made relates bounds mentioning parameters (`#agree`). */
  #depth = 0;

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
    copyInto(other.#admitting, this.#admitting);
    this.#revision += 1;
  }

  /** Lets `parameter` stand only under what `admits` takes, as a placeholder does. */
  admit(parameter: ParameterKey, admits: Admits): void {
    this.#admitting.set(parameter, admits);
    this.#revision += 1;
  }

  /** Whether `parameter` may stand under `bound`, as an upper bound or an equality. */
  #admits(parameter: ParameterKey, bound: Type): boolean {
    return this.#admitting.get(parameter)?.(bound, this.#rules.isOpen) ?? true;
  }

  /** What `parameter` is bound by so far. */
  of(parameter: ParameterKey): VariableBounds {
    return this.#bounds.get(parameter) ?? noBounds;
  }

  /** The variables `parameter` is related to (`relate`): those below it, and those above it. */
  relatedOf(parameter: ParameterKey): Related {
    return { below: this.#below.get(parameter) ?? [], above: this.#above.get(parameter) ?? [] };
  }

  /** The store's state as a key: a new one after every change (`#changed`), rollbacks included. */
  get revision(): number {
    return this.#revision;
  }

  /** A point to roll back to. */
  mark(): number {
    return this.#undo.length;
  }

  /** Undoes every change made since `mark`. */
  rollback(mark: number): void {
    while (this.#undo.length > mark) {
      this.#undo.pop()?.();
      this.#revision += 1;
    }
  }

  /**
   * Bounds `upper` below by `lower`, both variables: each lower bound of `lower`, now and later,
   * is one of `upper` too, and each upper bound of `upper` one of `lower`, so an expected type
   * reaches a variable through another; false when their requirements disagree, which advice
   * never makes them.
   */
  relate(lower: ParameterKey, upper: ParameterKey): boolean {
    if (lower === upper || (this.#above.get(lower) ?? []).includes(upper)) {
      return true;
    }
    this.#link(this.#above, lower, upper);
    this.#link(this.#below, upper, lower);
    const below = this.of(lower);
    const above = this.of(upper);
    return (
      [...joining(below.lower), ...asLower(below.equal)].every(
        (bound) => this.addLower(upper, bound) || isAdvice(bound),
      ) &&
      [...above.upper, ...asUpper(above.equal)].every(
        (bound) => this.addUpper(lower, bound) || isAdvice(bound),
      )
    );
  }

  /** Adds a lower bound; false when it disagrees with the bounds it is checked against. */
  addLower(parameter: ParameterKey, bound: LowerBound): boolean {
    const bounds = this.of(parameter);
    if (bounds.lower.some((each) => this.#isSame(each, bound))) {
      return true;
    }
    const checked = checkedAgainst(bounds, bound);
    const lower = [...bounds.lower, bound];
    // An item apart is judged by what its literal's items agree on, never against these.
    const agrees =
      bound.isApart === true ||
      (this.#takes(parameter, checked.equal, bound) &&
        checked.upper.every((upper) => this.#agree(parameter, bound, upper)));
    if (agrees) {
      this.#set(parameter, { ...bounds, lower });
      this.#advised(parameter, bounds, bound, 'lower');
    }
    return (
      agrees &&
      (bound.isApart === true ||
        (this.#above.get(parameter) ?? []).every((upper) => this.addLower(upper, bound)))
    );
  }

  /** Adds an upper bound; false when it disagrees with the bounds it is checked against. */
  addUpper(parameter: ParameterKey, bound: Bound): boolean {
    const bounds = this.of(parameter);
    if (bounds.upper.some((each) => this.#isSame(each, bound))) {
      return true;
    }
    if (!this.#admits(parameter, bound.type)) {
      return false;
    }
    const checked = checkedAgainst(bounds, bound);
    const agrees =
      (checked.equal === undefined || this.#agree(parameter, checked.equal, bound)) &&
      joining(checked.lower).every((lower) => this.#agree(parameter, lower, bound));
    if (agrees) {
      this.#set(parameter, { ...bounds, upper: [...bounds.upper, bound] });
      this.#advised(parameter, bounds, bound, 'upper');
    }
    return (
      agrees && (this.#below.get(parameter) ?? []).every((lower) => this.addUpper(lower, bound))
    );
  }

  /** Whether two bounds are the same: of one type and one role. */
  #isSame(first: Bound, second: Bound): boolean {
    return (
      first.advice === second.advice &&
      first.by === second.by &&
      this.#rules.same(first.type, second.type)
    );
  }

  /**
   * Relates `added`, a requirement `parameter` was just given as one of its bounds of kind `as`, to
   * the advice it held before (`before`), so what the expected type says reaches what the
   * requirement mentions, whichever came first. Advice the requirement disagrees with stays apart,
   * for settling to set aside (settle.ts); it never refuses the requirement.
   */
  #advised(
    parameter: ParameterKey,
    before: VariableBounds,
    added: Bound,
    as: 'lower' | 'upper' | 'equal',
  ): void {
    if (isAdvice(added)) {
      return;
    }
    const equal = before.equal !== undefined && isAdvice(before.equal) ? before.equal : undefined;
    if (as === 'equal' && equal !== undefined) {
      this.#equate(parameter, equal, added);
    }
    const otherEqual = as === 'equal' || equal === undefined ? [] : [equal];
    if (as !== 'upper') {
      for (const above of [...before.upper.filter(isAdvice), ...otherEqual]) {
        this.#agree(parameter, added, above);
      }
    }
    if (as !== 'lower') {
      for (const below of [...joining(before.lower).filter(isAdvice), ...otherEqual]) {
        this.#agree(parameter, below, added);
      }
    }
  }

  /** Links `to` after `from` in `links`, undone on rollback. */
  #link(
    links: Map<ParameterKey, readonly ParameterKey[]>,
    from: ParameterKey,
    to: ParameterKey,
  ): void {
    const before = links.get(from);
    links.set(from, [...(before ?? []), to]);
    this.#changed(() => {
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
    const checked = checkedAgainst(bounds, bound);
    const { equal } = checked;
    if (equal !== undefined) {
      return this.#equate(parameter, equal, bound);
    }
    const agrees =
      this.#admits(parameter, bound.type) &&
      joining(checked.lower).every((lower) => this.#agree(parameter, lower, bound)) &&
      checked.upper.every((upper) => this.#agree(parameter, bound, upper));
    if (agrees) {
      this.#set(parameter, { ...bounds, equal: bound });
      this.#advised(parameter, bounds, bound, 'equal');
    }
    return (
      agrees &&
      (this.#below.get(parameter) ?? []).every((lower) => this.addUpper(lower, bound)) &&
      (this.#above.get(parameter) ?? []).every((upper) =>
        asLower(bound).every((lower) => this.addLower(upper, lower)),
      )
    );
  }

  /** Whether an equality of `parameter`, if any, takes a value of `bound`. */
  #takes(parameter: ParameterKey, equal: Bound | undefined, bound: Bound): boolean {
    return equal === undefined || this.#agree(parameter, bound, equal);
  }

  /**
   * Whether `parameter`'s bound `below` fits its bound `above`: as they are, or, where either
   * mentions a parameter still to be found, by bounding what it mentions (design.md §4), as Kotlin
   * incorporates a variable's bounds; a bound mentioning `parameter` itself is checked once
   * settling has substituted it, as is one met past `maximumDepth` bounds deep.
   */
  #agree(parameter: ParameterKey, below: Bound | LowerBound, above: Bound): boolean {
    const { isOpen, fits, takesShape, constrain, orderOf, same } = this.#rules;
    if (!(isOpen(below.type) || isOpen(above.type))) {
      const order = orderOf(parameter);
      if (order !== undefined) {
        return order.below(below.type, above.type, same);
      }
      return fits(below.type, above.type) || (isShape(below) && takesShape(above.type, below.type));
    }
    const relating = relatingOf(below, above);
    return this.#deeper(
      parameter,
      [below.type, above.type],
      () =>
        constrain(below.type, above.type, relating) ||
        (isShape(below) && this.#rules.constrainShape(above.type, below.type, relating)),
    );
  }

  /**
   * Whether `parameter`'s equalities `first` and `second` agree: the same type, or, where either
   * mentions a parameter still to be found, by equating what it mentions, as `#agree` relates.
   */
  #equate(parameter: ParameterKey, first: Bound, second: Bound): boolean {
    const { isOpen, same, equate } = this.#rules;
    if (!(isOpen(first.type) || isOpen(second.type))) {
      return same(first.type, second.type);
    }
    return this.#deeper(parameter, [first.type, second.type], () =>
      equate(first.type, second.type, {
        advice: isAdvice(first) || isAdvice(second),
        by: undefined,
      }),
    );
  }

  /**
   * Whether `relate` holds, a step deeper into relating bounds that mention parameters; true
   * unchecked where `types` mention `parameter` itself, or past `maximumDepth`, for settling to
   * check once it has substituted them.
   */
  #deeper(parameter: ParameterKey, types: readonly Type[], relate: () => boolean): boolean {
    const mentionsItself = types.some((type) => parametersIn(type).includes(parameter));
    if (mentionsItself || this.#depth >= maximumDepth) {
      return true;
    }
    this.#depth += 1;
    try {
      return relate();
    } finally {
      this.#depth -= 1;
    }
  }

  #set(parameter: ParameterKey, bounds: VariableBounds): void {
    const before = this.#bounds.get(parameter);
    this.#bounds.set(parameter, bounds);
    this.#changed(() => {
      if (before === undefined) {
        this.#bounds.delete(parameter);
      } else {
        this.#bounds.set(parameter, before);
      }
    });
  }

  /** Records a change made, by how to undo it. */
  #changed(undo: () => void): void {
    this.#undo.push(undo);
    this.#revision += 1;
  }
}

/** The lower bounds of `lower` its variable's other bounds are checked against: all but items apart. */
function joining(lower: readonly LowerBound[]): readonly LowerBound[] {
  return lower.filter(({ isApart }) => isApart !== true);
}

/** An equality as the lower bound it is to a variable above the one it holds for. */
function asLower(equal: Bound | undefined): readonly LowerBound[] {
  return equal === undefined ? [] : [{ ...equal, fresh: false, isShape: false }];
}

/** An equality as the upper bound it is to a variable below the one it holds for. */
function asUpper(equal: Bound | undefined): readonly Bound[] {
  return equal === undefined ? [] : [equal];
}

/**
 * The role relating a variable's bounds `below` and `above` bounds what they mention with: advice
 * where either is; made by the construct whose match made `above`, so what `below` mentions is
 * bounded as that construct's consumer would bound it, and what `above` mentions, its own, as what
 * it is given.
 */
function relatingOf(below: Bound, above: Bound): BoundRole {
  return { advice: isAdvice(below) || isAdvice(above), by: above.by };
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
 * The bounds `bound` is checked against: every bound for advice, which yields where it disagrees;
 * the requirements alone for a requirement, which advice never refuses.
 */
function checkedAgainst(bounds: VariableBounds, bound: Bound): VariableBounds {
  return isAdvice(bound) ? bounds : requirementsOf(bounds);
}
