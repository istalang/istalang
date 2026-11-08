/**
 * A call's inference, and that of the calls and literals joining it (design.md §4), as one system
 * of their variables (variables.ts): the bounds matching gives them (bounds.ts, relate.ts,
 * equal.ts), the types given some outright, the notes a failed or partial match leaves, and
 * settling them (settle.ts). Inference (infer.ts) speaks for one call in its parameters' names;
 * this class never meets a parameter, only the variables standing for them.
 *
 * - A system joining others starts as a copy of theirs (`joining`), so each candidate a call
 *   chooses among matches in a system of its own and leaves the others' untouched.
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
import type { AnyType, LiteralType, ParameterKey, Type } from '../type/index.ts';
import { errorType, isPrimitive } from '../type/primitives.ts';
import type { Joining } from '../unions/common-type.ts';
import { membersOf } from '../unions/unions.ts';
import { VariableBinding } from './binding.ts';
import { BoundStore, type VariableBounds } from './bounds.ts';
import { equalTypes } from './equal.ts';
import { MatchNotes } from './notes.ts';
import { type Relating, relatedAsIs } from './relate.ts';
import {
  expectedChoiceOf,
  type Settling,
  type SettlingView,
  settleAll,
  settleOne,
} from './settle.ts';
import {
  fixedOf,
  type SystemReading,
  shapeBuilds,
  solvedIn,
  tentativeOf,
} from './system-reading.ts';
import type { CallVariables } from './variables.ts';

/** What a match is: an argument's, the expected type's, or a method's receiver's. */
export type MatchKind = 'argument' | 'expected' | 'receiver';

/** What a given type was written as, which settling reads it by (§2, §3.1). */
export type Written =
  /** A literal, given as its base: its literal type, fresh, for settling to widen. */
  | { readonly kind: 'literal'; readonly literal: LiteralType }
  /** A struct literal of items, given as its shape, which builds a struct its fields give. */
  | { readonly kind: 'shape' };

/** How a variable no call claims settles: by its bounds alone. */
const settlesFreely: Settling = { admits: () => true, defaultOf: () => undefined };

export class CallSystem {
  /** Each variable's call: the variables it is one of. */
  readonly #calls = new Map<ParameterKey, CallVariables>();
  readonly #fitting: Fitting;
  readonly #joining: Joining;
  readonly #store: BoundStore;
  readonly #binding: VariableBinding;
  /** The types given, by variable: written type arguments, and what a receiver gave. */
  readonly #given = new Map<ParameterKey, Type>();
  /** What every variable settled to, once the system is solved (`solve`). */
  #solved: ReadonlyMap<ParameterKey, Type> | undefined;
  /** The variables standing at the top of the expected result (`expectResult`). */
  #atTop: ReadonlySet<ParameterKey> = new Set();
  readonly #notes = new MatchNotes();
  /** The variable whose bounds disagreed last inside the match being made. */
  #lastConflict: ParameterKey | undefined;
  /** The pairs of recursive types being related as they unfold (§3.17). */
  readonly #unfolding = new UnfoldingPairs();
  #kind: MatchKind = 'argument';
  /** What the given type of the match being made was written as, if it reads as more. */
  #written: Written | undefined;
  readonly #rules: ConversionRules;

  /** A system holding no variables yet, but those of each of `joining`, as they are bound. */
  constructor(fitting: Fitting, joining: readonly CallSystem[] = []) {
    this.#fitting = fitting;
    this.#joining = {
      fitOf: (found, expected) => fitOf(found, expected, fitting),
      typeRules: fitting,
      fitting,
    };
    this.#store = new BoundStore({
      fits: (found, expected) => fitOf(found, expected, fitting) !== undefined,
      builds: (shape, target) => shapeBuilds(shape, target, fitting),
      same: sameType,
      isOpen: (type) => this.mentionsVariable(type),
      constrain: (found, expected, origin) =>
        this.#as(origin, undefined, () => this.#constrain(found, expected)),
      equate: (first, second, origin) =>
        this.#as(origin, undefined, () => this.#atomic(() => this.#equal(first, second))),
    });
    this.#binding = new VariableBinding({
      store: this.#store,
      notes: this.#notes,
      fitting,
      joining: this.#joining,
      callOf: (variable) => this.#calls.get(variable),
      tentative: () => this.#tentativeSubstitution(),
      match: () => ({ kind: this.#kind, written: this.#written }),
      disagreed: (variable) => {
        this.#lastConflict = variable;
      },
    });
    const relating: Relating = {
      fitting,
      unfolding: this.#unfolding,
      isUnknown: (key) => this.#calls.has(key),
      bindLower: (variable, type) => this.#binding.lower(variable, type),
      bindUpper: (variable, type) => this.#binding.upper(variable, type),
      bindBetween: (lower, upper) => {
        const related = this.#store.relate(lower, upper);
        if (!related) {
          this.#lastConflict = upper;
        }
        return related;
      },
      equal: (declared, given) => this.#atomic(() => this.#equal(declared, given)),
      constrain: (found, expected) => this.#constrain(found, expected),
      trial: (probe) => this.#trial(probe),
      meetError: (declared) => this.#meetError(declared, errorType),
      noteNever: (variable) => this.#notes.metNever(variable),
    };
    this.#rules = {
      ...fitting,
      exact: (expected, found) => this.#atomic(() => relatedAsIs(expected, found, relating)),
      same: (expected, found) => this.#atomic(() => this.#equal(expected, found)),
      attempt: (probe) => this.#atomic(probe),
      meetsAny: (found, target) => this.#convertsInto(target, found),
    };
    for (const other of joining) {
      this.adopt(other);
    }
  }

  /** Adds a call's `variables`, those standing for its parameters `given` taken as given. */
  add(variables: CallVariables, given: Substitution): void {
    for (const variable of variables.variables) {
      this.#calls.set(variable, variables);
    }
    for (const [variable, type] of variables.byVariable(given)) {
      this.#given.set(variable, type);
    }
  }

  /** Takes `type` as given for `variable` from here on, as a method's receiver gives it. */
  give(variable: ParameterKey, type: Type): void {
    this.#given.set(variable, type);
  }

  /** The type given for `variable`, if any. */
  givenOf(variable: ParameterKey): Type | undefined {
    return this.#given.get(variable);
  }

  /**
   * Matches a value of `given` where `declared`, holding variables, is taken, as `kind` says,
   * `given` as `written` reads it; whether it fits.
   */
  match(declared: Type, given: Type, kind: MatchKind, written?: Written): boolean {
    return this.#as(kind, written, () => {
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
        member.kind === 'parameter' && this.#calls.has(member.declaration)
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
    return tentativeOf(variable, this.#reading);
  }

  /** Rule 2 alone for `variable` (settle.ts): what the expected type chooses for it, if anything. */
  expectedChoiceFor(variable: ParameterKey, settling: Settling): Type | undefined {
    return expectedChoiceOf(variable, this.#tentativeSubstitution(), this.#view(), settling);
  }

  /**
   * Settles `variable` now and takes it as found from here on, the variables its bounds mention
   * first, as those of a joined call (design.md §4).
   */
  fix(variable: ParameterKey, settling: Settling, fixing = new Set<ParameterKey>()): void {
    fixing.add(variable);
    for (const other of parametersIn(this.#store.of(variable).equal?.type ?? errorType)) {
      if (this.#calls.has(other) && !fixing.has(other) && this.fixedOf(other) === undefined) {
        this.fix(other, settling, fixing);
      }
    }
    const type = settleOne(variable, this.#tentativeSubstitution(), this.#view(), settling);
    if (type !== undefined) {
      this.#store.addEqual(variable, { type, origin: 'argument' });
    }
  }

  /** What `variable` is taken as found as, given or fixed (system-reading.ts). */
  fixedOf(variable: ParameterKey): Type | undefined {
    return fixedOf(variable, this.#reading);
  }

  /**
   * `variables` settled; one left out can't be inferred. Once the system is solved, as it is
   * (`solve`).
   */
  settle(variables: readonly ParameterKey[], settling: Settling): ReadonlyMap<ParameterKey, Type> {
    const solved = this.#solved;
    if (solved === undefined) {
      return settleAll(variables, this.#given, this.#view(), settling);
    }
    return new Map(
      variables.flatMap((variable) => {
        const type = solved.get(variable);
        return type === undefined ? [] : [[variable, type] as const];
      }),
    );
  }

  /**
   * Settles every variable together, each as its own call's `settlings` says, as the outermost
   * system of several calls is (design.md §4); each call then settles to what this chose.
   */
  solve(settlings: ReadonlyMap<ParameterKey, Settling>): void {
    const settlingOf = (variable: ParameterKey) => settlings.get(variable) ?? settlesFreely;
    this.#solved = settleAll([...this.#calls.keys()], this.#given, this.#view(), {
      admits: (variable, type) => settlingOf(variable).admits(variable, type),
      defaultOf: (variable, settled) => settlingOf(variable).defaultOf(variable, settled),
    });
  }

  /** `type` with every variable as solved, the error type for one that couldn't be (`solve`). */
  solved(type: Type): Type {
    return solvedIn(type, this.#solved, this.#reading);
  }

  /** The variables whose bounds disagreed. */
  get conflicts(): ReadonlySet<ParameterKey> {
    return this.#notes.conflicts;
  }

  /** The member variables given a value of several members of their union, by what was given. */
  get severalMembers(): ReadonlyMap<ParameterKey, Type> {
    return this.#notes.severalMembers;
  }

  /** Runs `match` as a match of `kind`, a written literal's base given as `fresh`'s. */
  #as<Result>(kind: MatchKind, written: Written | undefined, match: () => Result): Result {
    const [kindBefore, writtenBefore] = [this.#kind, this.#written];
    this.#kind = kind;
    this.#written = written;
    try {
      return match();
    } finally {
      this.#kind = kindBefore;
      this.#written = writtenBefore;
    }
  }

  /** What reading the variables needs of this system (system-reading.ts). */
  get #reading(): SystemReading {
    return {
      fitting: this.#fitting,
      isVariable: (key) => this.#calls.has(key),
      givenOf: (variable) => this.#given.get(variable),
      boundsOf: (variable) => this.#store.of(variable),
      join: (variable, lower, upper) => this.#binding.join(variable, lower, upper),
    };
  }

  /** Takes on `other`'s variables, the types given them, their bounds, and the notes made. */
  adopt(other: CallSystem): void {
    for (const [variable, call] of other.#calls) {
      this.#calls.set(variable, call);
    }
    for (const [variable, type] of other.#given) {
      this.#given.set(variable, type);
    }
    this.#store.adopt(other.#store);
    this.#notes.adopt(other.#notes);
  }

  /** What has been found so far for the variables, as a substitution of them. */
  #tentativeSubstitution(): Substitution {
    const found = new Map(this.#given);
    for (const variable of this.#calls.keys()) {
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
      builds: (shape, target) => shapeBuilds(shape, target, this.#fitting),
      join: (parameter, lower, upper) => this.#binding.join(parameter, lower, upper),
      fallbackOf: (parameter) => this.#notes.fallbackOf(parameter),
      relatedOf: (parameter) => this.#store.relatedOf(parameter),
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
      this.#notes.conflict(this.#lastConflict);
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
      isUnknown: (key) => this.#calls.has(key),
      bind: (parameter, type) => this.#binding.equal(parameter, type),
      meetError: (inDeclared) => this.#meetError(inDeclared, errorType),
    });
  }

  /**
   * Whether `given` converts into `declared`, an `any` type: one whose parameters are all known,
   * since conversion binds none (§3.10).
   */
  #convertsInto(declared: AnyType, given: Type): boolean {
    const known = substitute(declared, this.#tentativeSubstitution(), this.#fitting);
    if (known.kind !== 'any' || this.mentionsVariable(known)) {
      return false;
    }
    return this.#fitting.meetsAny(given, known);
  }

  /** Notes `Never` given as `type`, when it is a variable. */
  #noteNeverAt(type: Type): void {
    if (type.kind === 'parameter' && this.#calls.has(type.declaration)) {
      this.#notes.metNever(type.declaration);
    }
  }

  /** Notes the variables `declared` mentions when `given` is the error type. */
  #meetError(declared: Type, given: Type): void {
    if (given.kind === 'error') {
      for (const key of parametersIn(declared)) {
        if (this.#calls.has(key)) {
          this.#notes.metError(key);
        }
      }
    }
  }

  /** Whether `type` mentions one of the variables this system holds. */
  mentionsVariable(type: Type): boolean {
    return parametersIn(type).some((key) => this.#calls.has(key));
  }
}
