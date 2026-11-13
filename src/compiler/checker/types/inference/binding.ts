/**
 * Bounding a system's variables by what a match finds (system.ts): a type a variable is given is a
 * lower bound, one where it gives an upper bound, one it must be exactly an equality, each of the
 * origin the match is of, and each as its variable is filled (fillings.ts): a pack only by what
 * stands for one, a member variable only by a type of one member of its union. A receiver's match
 * binds exactly; a written literal's base bound gives its literal type, fresh; a struct literal's
 * shape builds what it settles to (§3.1). A bound that disagrees notes its variable, `Never` and
 * the error type are noted where they meet one.
 */

import type { Fitting } from '../fitting/fit/index.ts';
import { sameType } from '../identity/identity.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import { fillsPack, isPack } from '../type/function-types.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { isPrimitive } from '../type/primitives.ts';
import type { Joining } from '../unions/common-type.ts';
import { baseOf } from '../unions/union-members.ts';
import { parameterType } from '../written/resolve-type.ts';
import type { BoundStore } from './bounds.ts';
import { fillingOf, joinedLower } from './fillings.ts';
import type { Matching } from './matching.ts';
import type { MatchNotes } from './notes.ts';
import type { Bound, LowerBound } from './variable-bounds.ts';
import type { CallVariables } from './variables.ts';

/** What bounding a system's variables reads and writes of it. */
interface BindingTarget {
  readonly store: BoundStore;
  readonly notes: MatchNotes;
  readonly fitting: Fitting;
  readonly joining: Joining;
  /** The call `variable` is one of the variables of, if it is one of the system's. */
  readonly callOf: (variable: ParameterKey) => CallVariables | undefined;
  /** What has been found so far for `variables`, as a substitution of them. */
  readonly tentative: (variables: Iterable<ParameterKey>) => Substitution;
  /** The match being made. */
  readonly match: () => Matching;
  /** Notes `variable` as the last whose bounds disagreed. */
  readonly disagreed: (variable: ParameterKey) => void;
}

/** Bounds variables by what matches find, as the banner says. */
export class VariableBinding {
  readonly #target: BindingTarget;

  constructor(target: BindingTarget) {
    this.#target = target;
  }

  /** Bounds `variable` below by `given`; whether its bounds agree. */
  lower(variable: ParameterKey, given: Type): boolean {
    const filling = this.#filling(variable, given);
    if (filling === undefined) {
      return false;
    }
    const { store } = this.#target;
    const { kind, written } = this.#target.match();
    if (kind === 'receiver') {
      return this.#added(variable, store.addEqual(variable, this.#bound(filling)));
    }
    const literal = written?.kind === 'literal' ? written.literal : undefined;
    const fresh = literal !== undefined && sameType(filling, baseOf(literal));
    const isShape = written?.kind === 'shape' && filling.kind === 'anonymous';
    const bound: LowerBound = {
      ...this.#bound(literal !== undefined && fresh ? literal : filling),
      fresh,
      isShape,
      isApart: written?.kind === 'apart',
    };
    return this.#added(variable, store.addLower(variable, bound));
  }

  /** Bounds `variable` above by `expected`; whether its bounds agree. */
  upper(variable: ParameterKey, expected: Type): boolean {
    if (isPack(parameterType(variable)) && !fillsPack(expected)) {
      return false;
    }
    const { store } = this.#target;
    const bound = this.#bound(expected);
    return this.#added(
      variable,
      this.#target.match().kind === 'receiver'
        ? store.addEqual(variable, bound)
        : store.addUpper(variable, bound),
    );
  }

  /** Bounds `variable` exactly by `given`; `Never` bounds nothing but is noted. */
  equal(variable: ParameterKey, given: Type): boolean {
    if (isPrimitive(given, 'Never') && !isPack(parameterType(variable))) {
      this.#target.notes.metNever(variable);
      return true;
    }
    const filling = this.#filling(variable, given);
    return (
      filling !== undefined &&
      this.#added(variable, this.#target.store.addEqual(variable, this.#bound(filling)))
    );
  }

  /**
   * The type `lower` bounds of `variable` join to (fillings.ts), by its order where it stands for a
   * mark or a sendability (types/type/mark-orders.ts).
   */
  join(
    variable: ParameterKey,
    lower: readonly LowerBound[],
    upper: readonly Bound[],
  ): Type | undefined {
    const order = this.#target.fitting.qualifierOf(variable)?.order;
    if (order !== undefined) {
      return order.join(
        lower.map(({ type }) => type),
        sameType,
      );
    }
    const isMember = this.#memberUnionOf(variable) !== undefined;
    return joinedLower(isMember, lower, upper, this.#target.joining);
  }

  /** A bound of `type` from the match being made: advice for the expected type's, made by its construct. */
  #bound(type: Type): Bound {
    const { kind, by } = this.#target.match();
    return { type, advice: kind === 'expected', by };
  }

  /** `added`, noting `variable` as the last whose bounds disagreed when it is false. */
  #added(variable: ParameterKey, added: boolean): boolean {
    if (!added) {
      this.#target.disagreed(variable);
    }
    return added;
  }

  /** What `given` fills `variable` with (fillings.ts), several members noted as such. */
  #filling(variable: ParameterKey, given: Type): Type | undefined {
    const { fitting, notes } = this.#target;
    const union = this.#memberUnionOf(variable);
    const filling = fillingOf(
      variable,
      given,
      union === undefined
        ? undefined
        : substitute(union, this.#target.tentative(parametersIn(union)), fitting),
      fitting,
    );
    if (filling.kind === 'severalMembers') {
      notes.severalMembersGiven(variable, given);
    }
    return filling.kind === 'fills' ? filling.type : undefined;
  }

  /** The union a member parameter's variable stands for one member of, as the variable carries it. */
  #memberUnionOf(variable: ParameterKey): Type | undefined {
    const call = this.#target.callOf(variable);
    const parameter = call?.parameterOf(variable);
    const type = parameter === undefined ? undefined : call?.typeOf(parameter);
    return type === undefined ? undefined : this.#target.fitting.memberUnionOf(type);
  }
}
