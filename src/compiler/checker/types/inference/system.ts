/**
 * The inference of the calls and literals of one constraint scope (design.md §4,
 * wiring/body/constraint-scope.ts), as one system of their variables (variables.ts): the bounds
 * matching gives them (bounds.ts, relate.ts, equal.ts), the types given some outright, the notes a
 * failed or partial match leaves, and settling them (settle.ts). Inference (infer.ts) speaks for
 * one call in its parameters' names; this class meets only the variables standing for them.
 *
 * - A candidate's system starts as a copy of its scope's (`joining`), so each candidate a call
 *   chooses among matches in a system of its own and leaves the scope untouched; the chosen one's
 *   is taken on by the scope's (`adopt`).
 * - What a match bounds depends on what it is: an argument's bounds are its own construct's, or,
 *   on the variables of a construct it consumes, the consumer's (`Matching`); the expected type's
 *   advise (`yields`); and a receiver's are equalities its caller then gives. Which
 *   variables stand at the top of their construct's result is each construct's own (`yields`),
 *   kept as systems join.
 * - Matching probes: a failed match leaves no bound behind (`BoundStore.rollback`). Bounds that
 *   disagree make a conflict, noted for the variable, which then can't be inferred.
 * - The error type bounds nothing, noted for each variable it met; `Never` likewise where a
 *   variable is given it.
 */

import { RevisionMemo } from '../../../../foundation/structures/revision-memo.ts';
import type { Admits } from '../fitting/expected.ts';
import type { ConversionRules, Fitting } from '../fitting/fit/index.ts';
import { fitOf, matchConversion } from '../fitting/fit/index.ts';
import { sameType } from '../identity/identity.ts';
import { UnfoldingPairs } from '../identity/unfolding-pairs.ts';
import type { Substitution } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { errorType, isPrimitive } from '../type/primitives.ts';
import type { Joining } from '../unions/common-type.ts';
import { VariableBinding } from './binding.ts';
import { type BoundRules, BoundStore } from './bounds.ts';
import { equalTypes } from './equal.ts';
import { expectedMatch, type Matching, relatingMatch } from './matching.ts';
import { MatchNotes } from './notes.ts';
import { convertsIntoAny, orderedAsIs, type Relating, relatedAsIs } from './relate.ts';
import {
  expectedChoiceOf,
  type Settling,
  type SettlingOf,
  type SettlingView,
  settleAll,
  settleOne,
} from './settle.ts';
import {
  abandonedFrom,
  atTopOf,
  defaultsIn,
  fixedByBounds,
  fixedSubstitution,
  type SystemReading,
  settledAmong,
  settledBefore,
  settlingViewOf,
  shapeTaking,
  solvedIn,
  takesShape,
  tentativeSubstitution,
} from './system-reading.ts';
import { mentionedBy, type VariableBounds } from './variable-bounds.ts';
import type { CallVariables } from './variables.ts';

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
  /**
   * The variables standing at the top of their own construct's result (`yields`), where rule 2
   * doesn't choose (settle.ts).
   */
  readonly #atTop = new Set<ParameterKey>();
  readonly #notes = new MatchNotes();
  /** The variable whose bounds disagreed last inside the match being made. */
  #lastConflict: ParameterKey | undefined;
  /** The pairs of recursive types being related as they unfold (§4.6). */
  readonly #unfolding = new UnfoldingPairs();
  #matching: Matching = { kind: 'argument', by: undefined, written: undefined };
  readonly #rules: ConversionRules;
  /**
   * Counts calls added, types given and systems adopted; the store counts its own changes. Both
   * only grow, so their sum names the system's state, which `fixedOf` is memoized by.
   */
  #changes = 0;
  readonly #fixed = new RevisionMemo<ParameterKey, Type | undefined>();
  /** What reading the variables needs of this system (system-reading.ts). */
  readonly reading: SystemReading;
  /** What settling reads of this system. */
  readonly #view: SettlingView;

  /** A system holding no variables yet, but those of each of `joining`, as they are bound. */
  constructor(fitting: Fitting, joining: readonly CallSystem[] = []) {
    this.#fitting = fitting;
    this.reading = this.#readingOf();
    this.#view = settlingViewOf(this.reading, this.#atTop);
    this.#joining = {
      fitOf: (found, expected) => fitOf(found, expected, fitting),
      typeRules: fitting,
      fitting,
    };
    this.#store = new BoundStore(this.#boundRules());
    this.#binding = new VariableBinding({
      store: this.#store,
      notes: this.#notes,
      fitting,
      joining: this.#joining,
      callOf: (variable) => this.#calls.get(variable),
      tentative: (variables) => tentativeSubstitution(this.reading, variables),
      match: () => this.#matching,
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
      ordered: (order, lower, upper) =>
        this.#atomic(() => orderedAsIs(order, lower, upper, relating)),
      attempt: (probe) => this.#atomic(probe),
      trial: (probe) => this.#trial(probe),
      meetsAny: (found, target) => this.#atomic(() => convertsIntoAny(target, found, relating)),
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
    this.#changes += 1;
  }

  /** Takes `type` as given for `variable` from here on, as a method's receiver gives it. */
  give(variable: ParameterKey, type: Type): void {
    this.#given.set(variable, type);
    this.#changes += 1;
  }

  /** Lets `variable` stand only under what `admits` takes, as a placeholder does. */
  admit(variable: ParameterKey, admits: Admits): void {
    this.#store.admit(variable, admits);
  }

  /** The type given for `variable`, if any. */
  givenOf(variable: ParameterKey): Type | undefined {
    return this.#given.get(variable);
  }

  /**
   * Matches a value of `given` where `declared`, holding variables, is taken, as `matching` says;
   * whether it fits.
   */
  match(declared: Type, given: Type, matching: Matching): boolean {
    return this.#as(matching, () => {
      this.#meetError(declared, given);
      if (isPrimitive(given, 'Never') && declared.kind === 'parameter') {
        this.#noteNeverAt(declared);
      }
      return this.#made(() => this.#constrain(given, declared));
    });
  }

  /** Matches `declared` against a type `given` must be exactly, as `matching` says. */
  matchExactly(declared: Type, given: Type, matching: Matching): boolean {
    return this.#as(matching, () => {
      this.#meetError(declared, given);
      return this.#made(() => this.#equal(declared, given));
    });
  }

  /**
   * Notes `result`, a construct's, holding its variables: those at its top (`#atTop`); and bounds
   * it by the type it is `expected` to give, if any, which only advises: where the two disagree,
   * nothing is bounded.
   */
  yields(result: Type, expected: Type | undefined): void {
    for (const variable of atTopOf(result, this.reading)) {
      this.#atTop.add(variable);
    }
    if (expected !== undefined) {
      this.#as(expectedMatch, () => this.#atomic(() => this.#constrain(result, expected)));
    }
  }

  /** What `variable` is bound by so far. */
  boundsOf(variable: ParameterKey): VariableBounds {
    return this.#store.of(variable);
  }

  /** Rule 2 alone for `variable` (settle.ts): what the expected type chooses for it, if anything. */
  expectedChoiceFor(variable: ParameterKey, settling: Settling): Type | undefined {
    const told = tentativeSubstitution(this.reading, mentionedBy(this.boundsOf(variable)));
    return expectedChoiceOf(variable, told, this.#view, settling);
  }

  /**
   * Settles `variable` now and takes it as found from here on, after what it waits on, in the order
   * settling all of them would (design.md §4, `settledBefore`); each as `settlingOf` says.
   */
  fix(variable: ParameterKey, settlingOf: SettlingOf, fixing = new Set<ParameterKey>()): void {
    fixing.add(variable);
    for (const other of settledBefore(variable, this.reading)) {
      if (!fixing.has(other)) {
        this.fix(other, settlingOf, fixing);
      }
    }
    // It reads what is fixed so far, as settling them all reads what it settled before.
    const fixed = fixedSubstitution(this.reading, this.#calls.keys());
    const settled = settleOne(variable, fixed, this.#view, settlingOf(variable));
    if (settled !== undefined) {
      this.fixAs(variable, settled);
    }
  }

  /** Takes `variable` as `type` from here on, as an equality its own call requires. */
  fixAs(variable: ParameterKey, type: Type): void {
    this.#store.addEqual(variable, { type, advice: false, by: this.#calls.get(variable) });
  }

  /**
   * Fixes what only a default decides of `types` to it (`defaultsIn`): what settling would make of
   * it, nothing else bounding it; whether it fixed any.
   */
  fixDefaults(types: readonly Type[], settlingOf: SettlingOf): boolean {
    const fixing = types.flatMap((type) => [...defaultsIn(type, this.reading, settlingOf)]);
    for (const [variable, type] of fixing) {
      this.fixAs(variable, type);
    }
    return fixing.length > 0;
  }

  /** What `variable` is taken as found as, given or fixed (system-reading.ts). */
  fixedOf(variable: ParameterKey): Type | undefined {
    // Met again while its own is found, a variable is on a cycle of equalities: none is fixed.
    const fixed = () => fixedByBounds(variable, this.reading);
    return this.#fixed.get(this.#changes + this.#store.revision, variable, fixed, undefined);
  }

  /** `variables` settled, one left out can't be inferred; once the system is solved, as it is. */
  settle(variables: readonly ParameterKey[], settling: Settling): ReadonlyMap<ParameterKey, Type> {
    const solved = this.#solved;
    if (solved === undefined) {
      return settleAll(variables, this.#given, this.#view, settling);
    }
    return settledAmong(solved, variables);
  }

  /** Settles every variable together, each as `settlingOf` says its call's (design.md §4). */
  solve(settlingOf: SettlingOf): void {
    this.#solved = settleAll([...this.#calls.keys()], this.#given, this.#view, {
      admits: (variable, type) => settlingOf(variable).admits(variable, type),
      defaultOf: (variable, settled) => settlingOf(variable).defaultOf(variable, settled),
    });
  }

  /** `type` with every variable as solved, the error type for one that couldn't be (`solve`). */
  solved(type: Type): Type {
    return solvedIn(type, this.#solved, this.reading);
  }

  /** The variables whose bounds disagreed. */
  get conflicts(): ReadonlySet<ParameterKey> {
    return this.#notes.conflicts;
  }

  /** The member variables given a value of several members of their union, by what was given. */
  get severalMembers(): ReadonlyMap<ParameterKey, Type> {
    return this.#notes.severalMembers;
  }

  /** Runs `match` as the match `matching` says. */
  #as<Result>(matching: Matching, match: () => Result): Result {
    const before = this.#matching;
    this.#matching = matching;
    try {
      return match();
    } finally {
      this.#matching = before;
    }
  }

  /** What reading the variables needs of this system, each read as the system then stands. */
  #readingOf(): SystemReading {
    return {
      fitting: this.#fitting,
      isVariable: (key) => this.#calls.has(key),
      callOf: (variable) => this.#calls.get(variable),
      givenOf: (variable) => this.#given.get(variable),
      fixedOf: (variable) => this.fixedOf(variable),
      boundsOf: (variable) => this.#store.of(variable),
      relatedOf: (variable) => this.#store.relatedOf(variable),
      join: (variable, lower, upper) => this.#binding.join(variable, lower, upper),
      fallbackOf: (variable) => this.#notes.fallbackOf(variable),
      variables: () => this.#calls.keys(),
    };
  }

  /** The rules the bound store checks bounds by, matching through this system. */
  #boundRules(): BoundRules {
    const fitting = this.#fitting;
    return {
      fits: (found, expected) => fitOf(found, expected, fitting) !== undefined,
      orderOf: (parameter) => fitting.qualifierOf(parameter)?.order,
      takesShape: (target, shape) => takesShape(target, shape, fitting),
      same: sameType,
      isOpen: (type) => this.mentionsVariable(type),
      constrain: (found, expected, relating) =>
        this.#as(relatingMatch(relating), () => this.#constrain(found, expected)),
      equate: (first, second, relating) =>
        this.#as(relatingMatch(relating), () => this.#atomic(() => this.#equal(first, second))),
      constrainShape: (target, shape, relating) =>
        this.#as(relatingMatch(relating), () => {
          const fields = shapeTaking(target, shape, fitting);
          return fields !== undefined && this.#atomic(() => this.#constrain(shape, fields));
        }),
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
    for (const variable of other.#atTop) {
      this.#atTop.add(variable);
    }
    this.#store.adopt(other.#store);
    this.#notes.adopt(other.#notes);
    this.#changes += 1;
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

  /** Notes `Never` given as `type`, when it is a variable. */
  #noteNeverAt(type: Type): void {
    if (type.kind === 'parameter' && this.#calls.has(type.declaration)) {
      this.#notes.metNever(type.declaration);
    }
  }

  /** Notes the variables `declared` mentions when `given` is the error type. */
  #meetError(declared: Type, given: Type): void {
    const met = given.kind === 'error' ? parametersIn(declared) : [];
    for (const key of met.filter((each) => this.#calls.has(each))) {
      this.#notes.metError(key);
    }
  }

  /**
   * Gives the error type where `type`, holding variables, goes, as a call that can't be made gives
   * its arguments: each variable it reaches notes it met it, so one nothing else bounds settles to it.
   */
  abandon(type: Type): void {
    for (const variable of abandonedFrom(type, this.reading)) {
      this.#notes.metError(variable);
    }
  }

  /** Whether `type` mentions one of the variables this system holds. */
  mentionsVariable(type: Type): boolean {
    return parametersIn(type).some((key) => this.#calls.has(key));
  }
}
