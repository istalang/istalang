/**
 * A call's inference as a system of its variables (variables.ts): the bounds matching gives them
 * (bounds.ts, relate.ts, equal.ts), the notes a failed or partial match leaves, and settling them
 * (settle.ts). Inference (infer.ts) speaks for it in its parameters' names; this class never meets
 * a parameter, only the variables standing for them.
 *
 * - What a match bounds depends on what it is: an argument's bounds are its own, the expected
 *   type's advise (`expectResult`), and a receiver's are equalities its caller then gives.
 * - Matching probes: a failed match leaves no bound behind (`BoundStore.rollback`). Bounds that
 *   disagree make a conflict, noted for the variable, which then can't be inferred.
 * - The error type bounds nothing, noted for each variable it met; `Never` likewise where a
 *   variable is given it.
 */

import type { ConversionRules, Fitting } from '../fitting/fit/index.ts';
import { fitOf, matchConversion } from '../fitting/fit/index.ts';
import { sameType } from '../identity/identity.ts';
import { UnfoldingPairs } from '../identity/unfolding-pairs.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import { fillsPack, isPack } from '../type/function-types.ts';
import type { AnyType, LiteralType, ParameterKey, Type } from '../type/index.ts';
import { errorType, isPrimitive, neverType } from '../type/primitives.ts';
import type { Joining } from '../unions/common-type.ts';
import { baseOf } from '../unions/union-members.ts';
import { membersOf } from '../unions/unions.ts';
import { parameterType } from '../written/resolve-type.ts';
import { type Bound, BoundStore, type LowerBound, type VariableBounds } from './bounds.ts';
import { equalTypes } from './equal.ts';
import { fillingOf, joinedLower } from './fillings.ts';
import { type Relating, relatedAsIs } from './relate.ts';
import {
  expectedChoiceOf,
  type Settling,
  type SettlingView,
  settleAll,
  settleOne,
} from './settle.ts';
import type { CallVariables } from './variables.ts';

/** What a match is: an argument's, the expected type's, or a method's receiver's. */
export type MatchKind = 'argument' | 'expected' | 'receiver';

const noVariables: ReadonlySet<ParameterKey> = new Set();
const noMembers: ReadonlyMap<ParameterKey, Type> = new Map();

export class CallSystem {
  readonly #variables: CallVariables;
  readonly #fitting: Fitting;
  readonly #joining: Joining;
  readonly #store: BoundStore;
  /** The types given, by variable: written type arguments, and what a receiver gave. */
  readonly #given: () => Substitution;
  /** The variables standing at the top of the expected result (`expectResult`). */
  #atTop: ReadonlySet<ParameterKey> = noVariables;
  #conflicts: Set<ParameterKey> | undefined;
  /** The variable whose bounds disagreed last inside the match being made. */
  #lastConflict: ParameterKey | undefined;
  #metNever: Set<ParameterKey> | undefined;
  #metError: Set<ParameterKey> | undefined;
  #severalMembers: Map<ParameterKey, Type> | undefined;
  /** The pairs of recursive types being related as they unfold (§3.17). */
  readonly #unfolding = new UnfoldingPairs();
  #kind: MatchKind = 'argument';
  /** The written literal the match being made gives as its base, whose literal type is fresh. */
  #fresh: LiteralType | undefined;
  readonly #rules: ConversionRules;

  constructor(variables: CallVariables, fitting: Fitting, givenTypes: () => Substitution) {
    this.#variables = variables;
    this.#fitting = fitting;
    this.#given = givenTypes;
    this.#joining = {
      fitOf: (found, expected) => fitOf(found, expected, fitting),
      typeRules: fitting,
      fitting,
    };
    this.#store = new BoundStore({
      fits: (found, expected) => fitOf(found, expected, fitting) !== undefined,
      same: sameType,
      isOpen: (type) => this.#mentionsVariable(type),
      join: (variable, lower, upper) => this.#join(variable, lower, upper),
    });
    const relating: Relating = {
      fitting,
      unfolding: this.#unfolding,
      isUnknown: (key) => this.#variables.isVariable(key),
      bindLower: (variable, type) => this.#bindLower(variable, type),
      bindUpper: (variable, type) => this.#bindUpper(variable, type),
      bindBetween: (lower, upper) => this.#added(upper, this.#store.relate(lower, upper)),
      equal: (declared, given) => this.#atomic(() => this.#equal(declared, given)),
      constrain: (found, expected) => this.#constrain(found, expected),
      trial: (probe) => this.#trial(probe),
      meetError: (declared) => this.#meetError(declared, errorType),
      noteNever: (variable) => this.#noteNever(variable),
    };
    this.#rules = {
      ...fitting,
      exact: (expected, found) => this.#atomic(() => relatedAsIs(expected, found, relating)),
      same: (expected, found) => this.#atomic(() => this.#equal(expected, found)),
      attempt: (probe) => this.#atomic(probe),
      meetsAny: (found, target) => this.#convertsInto(target, found),
    };
  }

  /**
   * Matches a value of `given` where `declared`, holding variables, is taken, as `kind` says, a
   * written literal's base given as `fresh`'s; whether it fits.
   */
  match(declared: Type, given: Type, kind: MatchKind, fresh?: LiteralType): boolean {
    return this.#as(kind, fresh, () => {
      this.#meetError(declared, given);
      if (isPrimitive(given, 'Never') && declared.kind === 'parameter') {
        this.#noteNeverAt(declared);
      }
      return this.#made(() => this.#constrain(given, declared));
    });
  }

  /** Matches `declared` against a type `given` must be exactly, as `kind` says. */
  matchExactly(declared: Type, given: Type, kind: MatchKind): boolean {
    return this.#as(kind, undefined, () => {
      this.#meetError(declared, given);
      return this.#made(() => this.#equal(declared, given));
    });
  }

  /**
   * Bounds `result`, holding variables, by the type it is `expected` to give, which only advises:
   * where the two disagree, nothing is bounded.
   */
  expectResult(result: Type, expected: Type): void {
    this.#atTop = new Set(
      membersOf(result).flatMap((member) =>
        member.kind === 'parameter' && this.#variables.isVariable(member.declaration)
          ? [member.declaration]
          : [],
      ),
    );
    this.#as('expected', undefined, () => this.#atomic(() => this.#constrain(result, expected)));
  }

  /** What `variable` is bound by so far. */
  boundsOf(variable: ParameterKey): VariableBounds {
    return this.#store.of(variable);
  }

  /** What a variable's bounds tell so far: its equality, its lower bounds' join, else its upper bound. */
  tentative(variable: ParameterKey): Type | undefined {
    const { equal, lower, upper } = this.#store.of(variable);
    if (equal !== undefined) {
      return equal.type;
    }
    if (lower.length > 0) {
      return this.#join(variable, lower, upper);
    }
    const fits = (found: Type, expected: Type) =>
      fitOf(found, expected, this.#fitting) !== undefined;
    return upper.find((bound) => upper.every((other) => fits(bound.type, other.type)))?.type;
  }

  /** Rule 2 alone for `variable` (settle.ts): what the expected type chooses for it, if anything. */
  expectedChoiceFor(variable: ParameterKey, settling: Settling): Type | undefined {
    return expectedChoiceOf(variable, this.#tentativeSubstitution(), this.#view(), settling);
  }

  /** Settles `variable` now and takes it as found from here on. */
  fix(variable: ParameterKey, settling: Settling): void {
    const type = settleOne(variable, this.#tentativeSubstitution(), this.#view(), settling);
    if (type !== undefined) {
      this.#store.addEqual(variable, { type, origin: 'argument' });
    }
  }

  /** `variables` settled; one left out can't be inferred. */
  settle(variables: readonly ParameterKey[], settling: Settling): ReadonlyMap<ParameterKey, Type> {
    return settleAll(variables, this.#given(), this.#view(), settling);
  }

  /** The variables whose bounds disagreed. */
  get conflicts(): ReadonlySet<ParameterKey> {
    return this.#conflicts ?? noVariables;
  }

  /** The member parameters given a value of several members of their union, by what was given. */
  get severalMembers(): ReadonlyMap<ParameterKey, Type> {
    return this.#severalMembers ?? noMembers;
  }

  /** Runs `match` as a match of `kind`, a written literal's base given as `fresh`'s. */
  #as<Result>(kind: MatchKind, fresh: LiteralType | undefined, match: () => Result): Result {
    const [kindBefore, freshBefore] = [this.#kind, this.#fresh];
    this.#kind = kind;
    this.#fresh = fresh;
    try {
      return match();
    } finally {
      this.#kind = kindBefore;
      this.#fresh = freshBefore;
    }
  }

  /** What has been found so far for the variables, as a substitution of them. */
  #tentativeSubstitution(): Substitution {
    const found = new Map(this.#given());
    for (const variable of this.#variables.variables) {
      const type = found.has(variable) ? undefined : this.tentative(variable);
      if (type !== undefined) {
        found.set(variable, type);
      }
    }
    return found;
  }

  /** What settling reads of this inference. */
  #view(): SettlingView {
    return {
      rules: this.#fitting,
      boundsOf: (parameter) => this.#store.of(parameter),
      isAtTop: (parameter) => this.#atTop.has(parameter),
      fits: (found, expected) => fitOf(found, expected, this.#fitting) !== undefined,
      join: (parameter, lower, upper) => this.#join(parameter, lower, upper),
      fallbackOf: (parameter) => {
        if (this.#metError?.has(parameter) === true) {
          return errorType;
        }
        return this.#metNever?.has(parameter) === true ? neverType : undefined;
      },
    };
  }

  /** Runs `probe` and undoes every bound it added, whether or not it held. */
  #trial(probe: () => boolean): boolean {
    const mark = this.#store.mark();
    const held = probe();
    this.#store.rollback(mark);
    return held;
  }

  /**
   * Runs a whole match, noting the variable whose bounds disagreed when it fails for that reason;
   * a disagreement on a way the match didn't end up taking is no conflict.
   */
  #made(match: () => boolean): boolean {
    this.#lastConflict = undefined;
    const matched = match();
    if (!matched && this.#lastConflict !== undefined) {
      this.#conflicts ??= new Set();
      this.#conflicts.add(this.#lastConflict);
    }
    return matched;
  }

  /** Runs `probe`, undoing every bound it added when it fails. */
  #atomic(probe: () => boolean): boolean {
    const mark = this.#store.mark();
    const held = probe();
    if (!held) {
      this.#store.rollback(mark);
    }
    return held;
  }

  /** Whether a value of `found` fits `expected`, bounding the variables either mentions. */
  #constrain(found: Type, expected: Type): boolean {
    return this.#atomic(() => matchConversion(found, expected, this.#rules) !== undefined);
  }

  /** Whether `declared` and `given` are the very same type, a variable either holds equal. */
  #equal(declared: Type, given: Type): boolean {
    return equalTypes(declared, given, {
      unfolding: this.#unfolding,
      isUnknown: (key) => this.#variables.isVariable(key),
      bind: (parameter, type) => this.#bindEqual(parameter, type),
      meetError: (inDeclared) => this.#meetError(inDeclared, errorType),
    });
  }

  /**
   * Whether `given` converts into `declared`, an `any` type: one whose parameters are all known,
   * since conversion binds none (§3.10).
   */
  #convertsInto(declared: AnyType, given: Type): boolean {
    const known = substitute(declared, this.#tentativeSubstitution(), this.#fitting);
    if (known.kind !== 'any' || this.#mentionsVariable(known)) {
      return false;
    }
    return this.#fitting.meetsAny(given, known);
  }

  #bindLower(parameter: ParameterKey, given: Type): boolean {
    const filling = this.#filling(parameter, given);
    if (filling === undefined) {
      return false;
    }
    if (this.#kind === 'receiver') {
      return this.#added(parameter, this.#store.addEqual(parameter, this.#bound(filling)));
    }
    const literal = this.#fresh;
    const fresh = literal !== undefined && sameType(filling, baseOf(literal));
    const bound: LowerBound = { ...this.#bound(fresh ? literal : filling), fresh };
    return this.#added(parameter, this.#store.addLower(parameter, bound));
  }

  #bindUpper(parameter: ParameterKey, expected: Type): boolean {
    if (isPack(parameterType(parameter)) && !fillsPack(expected)) {
      return false;
    }
    const bound = this.#bound(expected);
    return this.#added(
      parameter,
      this.#kind === 'receiver'
        ? this.#store.addEqual(parameter, bound)
        : this.#store.addUpper(parameter, bound),
    );
  }

  /** Bounds `parameter` exactly by `given`; `Never` bounds nothing but is noted. */
  #bindEqual(parameter: ParameterKey, given: Type): boolean {
    if (isPrimitive(given, 'Never') && !isPack(parameterType(parameter))) {
      this.#noteNever(parameter);
      return true;
    }
    const filling = this.#filling(parameter, given);
    return (
      filling !== undefined &&
      this.#added(parameter, this.#store.addEqual(parameter, this.#bound(filling)))
    );
  }

  /** A bound of `type` from the match being made. */
  #bound(type: Type): Bound {
    return { type, origin: this.#kind === 'expected' ? 'expected' : 'argument' };
  }

  /** `added`, noting `parameter` as the last whose bounds disagreed when it is false. */
  #added(parameter: ParameterKey, added: boolean): boolean {
    if (!added) {
      this.#lastConflict = parameter;
    }
    return added;
  }

  /** What `given` fills `variable` with (fillings.ts), several members noted as such. */
  #filling(variable: ParameterKey, given: Type): Type | undefined {
    const union = this.#memberUnionOf(variable);
    const filling = fillingOf(
      variable,
      given,
      union === undefined
        ? undefined
        : substitute(union, this.#tentativeSubstitution(), this.#fitting),
      this.#fitting,
    );
    const parameter = this.#variables.parameterOf(variable);
    if (filling.kind === 'severalMembers' && parameter !== undefined) {
      this.#severalMembers ??= new Map();
      this.#severalMembers.set(parameter, given);
    }
    return filling.kind === 'fills' ? filling.type : undefined;
  }

  /** The union a member parameter's variable stands for one member of, as the variable carries it. */
  #memberUnionOf(variable: ParameterKey): Type | undefined {
    const parameter = this.#variables.parameterOf(variable);
    const type = parameter === undefined ? undefined : this.#variables.typeOf(parameter);
    return type === undefined ? undefined : this.#fitting.memberUnionOf(type);
  }

  /** The type `lower` bounds of `variable` join to (fillings.ts). */
  #join(
    variable: ParameterKey,
    lower: readonly LowerBound[],
    upper: readonly Bound[],
  ): Type | undefined {
    return joinedLower(this.#memberUnionOf(variable) !== undefined, lower, upper, this.#joining);
  }

  #noteNever(variable: ParameterKey): void {
    this.#metNever ??= new Set();
    this.#metNever.add(variable);
  }

  /** Notes `Never` given as `type`, when it is a variable. */
  #noteNeverAt(type: Type): void {
    if (type.kind === 'parameter' && this.#variables.isVariable(type.declaration)) {
      this.#noteNever(type.declaration);
    }
  }

  /** Notes the variables `declared` mentions when `given` is the error type. */
  #meetError(declared: Type, given: Type): void {
    if (given.kind === 'error') {
      for (const key of parametersIn(declared)) {
        if (this.#variables.isVariable(key)) {
          this.#metError ??= new Set();
          this.#metError.add(key);
        }
      }
    }
  }

  /** Whether `type` mentions one of the call's variables. */
  #mentionsVariable(type: Type): boolean {
    return parametersIn(type).some((key) => this.#variables.isVariable(key));
  }
}
