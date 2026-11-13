/**
 * Inferring type arguments (§3.5): each type parameter a call or literal leaves to inference is a
 * variable of its own (variables.ts), so a generic function's own call inside its body tells its
 * variables from its rigid parameters, and matching the types it is given against the types its
 * declaration takes bounds them (bounds.ts), which settling then decides (settle.ts). This class
 * speaks in the parameters' names; the system of variables it speaks for is system.ts.
 *
 * - A given type fits a declared one as any value fits (types/fitting/fit/): exactly, converted, or
 *   into a union, a type built of others part by part as its variance says. Where a variable
 *   stands, what fits there bounds it: a type it is given is a lower bound, a type where it gives
 *   (a function type's parameter) an upper bound, and a type where it must be the very type
 *   (invariant, `&`, a spread's items, a pack, a witness) an equality. A union given where its
 *   members may go apart puts each into its place, and one with variables puts each member, so
 *   `V?` expected to be a `Json` bounds `V` by `Json`.
 * - The expected type bounds the call's result likewise, but only advises (bounds.ts); rule 2
 *   knows which variables stand at the result's top (`expect`), and chooses among what consumes
 *   the call's value: an expected type, or an enclosing call's parameter (`Matching`).
 * - A type argument written is taken as given: what is matched has it in place before matching, so
 *   `f<Int?>(o)` for `fn f<T>(x: T?)` matches `Int?` against `Int?`. A method's receiver gives its
 *   variables the same way, as Swift and Rust bind a method's `Self` (`matchReceiver`): matched
 *   exactly at every position, then given, so `xs.includes(none)` for an `Array<Int>` is a
 *   mismatch, never a reason to widen what `xs` is.
 * - A literal written as an argument gives its literal type, fresh, unless its parameter expects a
 *   literal of its base, which it then is (`literalType`).
 * - A pack binds only what can stand for one, a tuple, `Unit` or a pack; a member parameter (`T in
 *   U`) only a type of one member of `U`, a literal of a member's base as that base, a value of
 *   several members noted as such (`severalMembers`), for the caller to narrow.
 * - The error type fits anything and bounds nothing while matching, so one mistake is reported
 *   once: a variable it met and nothing else bounds settles to it. `Never` bounds nothing either; a
 *   variable only it met where a type is given settles to `Never`.
 * - Matching probes: a failed match leaves no bound behind (`BoundStore.rollback`). Bounds that
 *   disagree make a conflict, noted for the variable, which then can't be inferred.
 * - What is settled (`settledIn`) is apart from what is found so far (`substitution`): a type
 *   parameter bounded only loosely may still grow, so what waits on it (a postponed argument, an
 *   argument the chosen function decides) reads it as open.
 */

import type { Admits } from '../fitting/expected.ts';
import type { Fitting } from '../fitting/fit/index.ts';
import { noSubstitution, type Substitution, substitute } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { LiteralType, LiteralValue, ParameterKey, Type } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { literalOrBase, unionOf } from '../unions/unions.ts';
import { fixingToward } from './fixing-toward.ts';
import type { Matching, MatchKind, Written } from './matching.ts';
import { type Settling, type SettlingOf, settlesFreely } from './settle.ts';
import { CallSystem } from './system.ts';
import {
  expectationOf,
  fixedIn,
  openIn,
  settlingViewOf,
  tentativeIn,
  tentativeOf,
  waitsOn,
} from './system-reading.ts';
import { CallVariables } from './variables.ts';

/** Where an inference stands: its call's site, and the system it infers in. */
interface InferenceSite {
  /** The call's own site, which its variables are twins at (variables.ts). */
  readonly site?: object | undefined;
  /**
   * A scope's inference (wiring/body/constraint-scope.ts): this one's system starts as a copy of its
   * system, as a candidate's does, so probing it leaves the scope untouched (`commitTo`).
   */
  readonly copying?: Inference | undefined;
}

/** A call or literal inferring, with how its type parameters settle where it stands. */
interface InferringCall {
  readonly inference: Inference;
  readonly settling: Settling;
}

export class Inference {
  readonly #parameters: readonly ParameterKey[];
  readonly #variables: CallVariables;
  readonly #fitting: Fitting;
  #system: CallSystem;
  /** What the match being made is, a receiver's matching as an argument's does otherwise. */
  #kind: MatchKind = 'argument';

  /**
   * `written` gives the type arguments written for some of `parameters`, taken as given (§3.5).
   * Each parameter is inferred as a variable of its own (variables.ts), in a system of its own, a
   * copy of `at.copying`'s where given.
   */
  constructor(
    parameters: Iterable<ParameterKey>,
    fitting: Fitting,
    written?: Substitution,
    at: InferenceSite = {},
  ) {
    this.#parameters = [...parameters];
    this.#variables = new CallVariables(this.#parameters, fitting, at.site);
    this.#fitting = fitting;
    this.#system = new CallSystem(fitting, at.copying === undefined ? [] : [at.copying.#system]);
    this.#system.add(this.#variables, written ?? noSubstitution);
  }

  /**
   * Moves this inference into `scope`'s system, which takes on everything matching found in its
   * own: a chosen candidate's, whose system started as a copy of the scope's
   * (wiring/body/constraint-scope.ts).
   */
  commitTo(scope: Inference): void {
    if (scope.#system !== this.#system) {
      scope.#system.adopt(this.#system);
      this.#system = scope.#system;
    }
  }

  /** Matches a value of `given` where `declared` is taken, bounding what it can; whether it fits. */
  match(declared: Type, given: Type): boolean {
    return this.#system.match(this.#prepared(declared), given, this.#matching());
  }

  /**
   * Matches a written literal where `declared` is taken: its literal type where a literal of its
   * base is expected; else as its base, so it goes where its base goes, a variable given it bound
   * by its literal type, fresh, for settling to widen (§2).
   */
  matchLiteral(declared: Type, literal: LiteralType): boolean {
    const typed = this.literalType(literal.value, declared);
    const prepared = this.#prepared(declared);
    return typed.kind === 'literal'
      ? this.#system.match(prepared, typed, this.#matching())
      : this.#system.match(prepared, typed, this.#matching({ kind: 'literal', literal }));
  }

  /**
   * Matches a struct literal of items where `declared` is taken, as its `shape`, which may build a
   * struct a variable settles to, as a literal where a struct is expected builds it (§3.1).
   */
  matchShape(declared: Type, shape: Type): boolean {
    return this.#system.match(this.#prepared(declared), shape, this.#matching({ kind: 'shape' }));
  }

  /**
   * Matches an item of a collection literal whose items agree on no one type, bounding only the
   * variable `declared` is, never one related to it (design.md §4).
   */
  matchApart(declared: Type, given: Type): boolean {
    return this.#system.match(this.#prepared(declared), given, this.#matching({ kind: 'apart' }));
  }

  /** Matches `declared` against a type `given` must be exactly, as a reference or a spread's. */
  matchExactly(declared: Type, given: Type): boolean {
    return this.#system.matchExactly(this.#prepared(declared), given, this.#matching());
  }

  /**
   * Matches a method's receiver against its `self`: by reference exactly, else as any value fits,
   * every variable it meets bound exactly and then given.
   */
  matchReceiver(declared: Type, given: Type, byReference: boolean): boolean {
    this.#kind = 'receiver';
    try {
      const matched = byReference
        ? this.matchExactly(declared, given)
        : this.match(declared, given);
      if (matched) {
        for (const parameter of parametersIn(declared)) {
          const variable = this.#variables.variableOf(parameter);
          const equal = variable === undefined ? undefined : this.#system.boundsOf(variable).equal;
          if (variable !== undefined && equal !== undefined) {
            this.#system.give(variable, equal.type);
          }
        }
      }
      return matched;
    } finally {
      this.#kind = 'argument';
    }
  }

  /**
   * Notes the call's `result`, so its variables at the top of it stand there (settle.ts rule 2),
   * and bounds it by the type it is `expected` to give, which only advises: where the two
   * disagree, nothing is bounded (bounds.ts).
   */
  expect(result: Type, expected: Type | undefined): void {
    this.#system.yields(this.#prepared(result), expected);
  }

  /**
   * Gives the error type where `type`, open in this system, goes, and so to every variable it reaches
   * (`CallSystem.abandon`).
   */
  abandon(type: Type): void {
    this.#system.abandon(this.#prepared(type));
  }

  /** `declared` as it stands open: the types given in place, and each parameter left its variable. */
  open(declared: Type): Type {
    return this.#prepared(declared);
  }

  /** Whether `type`, as it stands open, mentions a variable this inference's system holds. */
  mentionsVariables(type: Type): boolean {
    return this.#system.mentionsVariable(type);
  }

  /** Whether `parameter` is one this inference is finding. */
  isUnknown(parameter: ParameterKey): boolean {
    return this.#variables.variableOf(parameter) !== undefined;
  }

  /** The type found for `parameter` so far: given, equal, or what its bounds tell (`tentative`). */
  boundOf(parameter: ParameterKey): Type | undefined {
    const given = this.#givenOf(parameter);
    const variable = this.#variables.variableOf(parameter);
    if (given !== undefined || variable === undefined) {
      return given;
    }
    const found = tentativeOf(variable, this.#system.reading);
    return found === undefined ? undefined : this.#variables.restored(found);
  }

  /**
   * `type` with what is settled, and for the rest the expected type's choice where settling rule 2
   * would take it (settle.ts), else the variable: what a postponed argument's result is expected to
   * be, open in the system's variables, so what checks against it joins this system.
   */
  guided(type: Type, settling: Settling): Type {
    const settled = this.settledIn(type);
    const guide = new Map<ParameterKey, Type>();
    for (const parameter of parametersIn(settled)) {
      const variable = this.#variables.variableOf(parameter);
      const open = this.#variables.typeOf(parameter);
      const choice =
        variable === undefined
          ? undefined
          : this.#system.expectedChoiceFor(variable, this.#variables.settlingFor(settling));
      const guiding = choice ?? open;
      if (guiding !== undefined) {
        guide.set(parameter, guiding);
      }
    }
    return substitute(settled, guide, this.#fitting);
  }

  /**
   * How each variable of `calls`' inferences settles, as the call it stands for settles its
   * parameter; any other freely.
   */
  static settlingsOf(calls: readonly InferringCall[]): SettlingOf {
    const settlings = new Map<ParameterKey, Settling>();
    for (const { inference, settling } of calls) {
      const forVariables = inference.#variables.settlingFor(settling);
      for (const variable of inference.#variables.variables) {
        settlings.set(variable, forVariables);
      }
    }
    return (variable) => settlings.get(variable) ?? settlesFreely;
  }

  /**
   * Settles every variable of this inference's system at once, each as the call of `calls` it
   * stands for settles it (design.md §4); each call then settles to what this chose (`settle`).
   */
  solveJointly(calls: readonly InferringCall[]): void {
    this.#system.solve(Inference.settlingsOf(calls));
  }

  /**
   * Lets the variable `open` is, a placeholder (i2-scope.md §3), stand only under what `admits`
   * takes.
   */
  admitOpen(open: Type, admits: Admits): void {
    if (open.kind === 'parameter' && this.#system.mentionsVariable(open)) {
      this.#system.admit(open.declaration, admits);
    }
  }

  /**
   * Takes the variable `open` is as `type` from here on, as a placeholder is once its expression
   * is checked; what is related to it is bounded by `type` as a value of it bounds it.
   */
  settleAs(open: Type, type: Type): void {
    if (open.kind === 'parameter' && this.#system.mentionsVariable(open)) {
      this.#system.match(open, type, this.#matching());
      this.#system.give(open.declaration, type);
    }
  }

  /** `type`, open, with what the system's variables' bounds tell so far (system-reading.ts). */
  tentativeIn(type: Type): Type | undefined {
    return tentativeIn(type, this.#system.reading);
  }

  /** What is expected so far of `type`, open, when it is one of the system's variables. */
  expectationOf(type: Type, siblings = true): Type | undefined {
    return type.kind === 'parameter' && this.#system.mentionsVariable(type)
      ? expectationOf(type.declaration, this.#system.reading, siblings)
      : undefined;
  }

  /**
   * Whether checking a value of `inputs`, open, waits on what judging values of `given` bounds
   * (system-reading.ts `waitsOn`).
   */
  waitsOn(inputs: Type, given: readonly Type[]): boolean {
    return waitsOn(inputs, given, this.#system.reading);
  }

  /**
   * Fixes what the placeholders `waiting`, open, wait on, by what bounds it that mentions no
   * variable (fixing-toward.ts `fixingToward`); whether anything was.
   */
  fixToward(waiting: readonly Type[], settlingOf: SettlingOf): boolean {
    const variables = waiting.flatMap((type) =>
      type.kind === 'parameter' ? [type.declaration] : [],
    );
    const { reading } = this.#system;
    const view = settlingViewOf(reading, new Set());
    const fixing = fixingToward(variables, reading, view, settlingOf);
    for (const [variable, type] of fixing) {
      this.#system.fixAs(variable, type);
    }
    return fixing.size > 0;
  }

  /** Fixes what only a default decides of `types`, open, to it (`CallSystem.fixDefaults`). */
  fixDefaults(types: readonly Type[], settlingOf: SettlingOf): boolean {
    return this.#system.fixDefaults(types, settlingOf);
  }

  /** Settles and fixes each variable `type`, open, mentions, as `settlingOf` says (settle.ts). */
  fixIn(type: Type, settlingOf: SettlingOf): void {
    for (const variable of openIn(type, this.#system.reading)) {
      this.#system.fix(variable, settlingOf);
    }
  }

  /** `type`, open, with what is taken as found in place, the variables left open as they are. */
  fixedIn(type: Type): Type {
    return fixedIn(type, this.#system.reading);
  }

  /**
   * `type`, open, with what is taken as found in place, and for the rest the expected type's
   * choice where settling's rule 2 would take it (settle.ts), else the variable itself.
   */
  guidedIn(type: Type, settlingOf: SettlingOf): Type {
    const fixed = fixedIn(type, this.#system.reading);
    const guide = new Map<ParameterKey, Type>();
    for (const variable of openIn(fixed, this.#system.reading)) {
      const choice = this.#system.expectedChoiceFor(variable, settlingOf(variable));
      if (choice !== undefined) {
        guide.set(variable, choice);
      }
    }
    return guide.size === 0 ? fixed : substitute(fixed, guide, this.#fitting);
  }

  /** `type`, as it stands open, with what the system solved (`solveJointly`). */
  solved(type: Type): Type {
    return this.#system.solved(type);
  }

  /** `parameters` settled; one left out can't be inferred (settle.ts). */
  settle(parameters: readonly ParameterKey[], settling: Settling): ReadonlyMap<ParameterKey, Type> {
    const variables = parameters.flatMap(
      (parameter) => this.#variables.variableOf(parameter) ?? [],
    );
    const settled = this.#system.settle(variables, this.#variables.settlingFor(settling));
    const restored = new Map<ParameterKey, Type>();
    for (const [variable, type] of settled) {
      const parameter = this.#variables.parameterOf(variable);
      if (parameter !== undefined) {
        restored.set(parameter, this.#variables.restored(type));
      }
    }
    return restored;
  }

  /** The parameters whose bounds disagreed. */
  get conflicts(): ReadonlySet<ParameterKey> {
    return new Set(
      [...this.#system.conflicts].flatMap(
        (variable) => this.#variables.parameterOf(variable) ?? [],
      ),
    );
  }

  /** The member parameters given a value of several members of their union, by what was given. */
  get severalMembers(): ReadonlyMap<ParameterKey, Type> {
    const several = new Map<ParameterKey, Type>();
    for (const [variable, given] of this.#system.severalMembers) {
      const parameter = this.#variables.parameterOf(variable);
      if (parameter !== undefined) {
        several.set(parameter, given);
      }
    }
    return several;
  }

  /**
   * The type a literal of `value` has where `declared` is expected (§2, §3.5): its literal type
   * where a literal type of its base is expected, or a union holding one, or a member parameter
   * whose union holds one; its base otherwise.
   */
  literalType(value: LiteralValue, declared: Type): Type {
    const expected = this.substituted(declared);
    const taking = membersOf(expected).flatMap((member) => {
      const union = this.#fitting.memberUnionOf(member);
      return union === undefined ? [member] : membersOf(this.substituted(union));
    });
    return literalOrBase(value, unionOf(taking, this.#fitting), this.#fitting);
  }

  /**
   * What the system solved each parameter to, by parameter, the error type for one it couldn't
   * (`solveJointly`): a literal's type arguments where completing it failed.
   */
  solution(): Substitution {
    return this.#found((parameter) => {
      const open = this.#variables.typeOf(parameter);
      return open === undefined ? undefined : this.#variables.restored(this.#system.solved(open));
    });
  }

  /** What has been found so far for the parameters, as a substitution. */
  substitution(): Substitution {
    return this.#found((parameter) => this.boundOf(parameter));
  }

  /** `declared` with what has been found so far substituted. */
  substituted(declared: Type): Type {
    return substitute(declared, this.substitution(), this.#fitting);
  }

  /**
   * `declared` with only what is settled substituted: the types given and those fixed (`fix`), a
   * parameter still bounded loosely left as it is.
   */
  settledIn(declared: Type): Type {
    const settled = this.#found((_parameter, variable) => {
      const fixed = this.#system.fixedOf(variable);
      return fixed === undefined ? undefined : this.#variables.restored(fixed);
    });
    return substitute(declared, settled, this.#fitting);
  }

  /** The types given, then for each parameter left what `read` finds for it. */
  #found(
    read: (parameter: ParameterKey, variable: ParameterKey) => Type | undefined,
  ): Map<ParameterKey, Type> {
    const found = this.#givenTypes();
    for (const variable of this.#variables.variables) {
      const parameter = this.#variables.parameterOf(variable);
      const type =
        parameter === undefined || found.has(parameter) ? undefined : read(parameter, variable);
      if (parameter !== undefined && type !== undefined) {
        found.set(parameter, type);
      }
    }
    return found;
  }

  /** The match this inference makes now, its given type as `written` reads it. */
  #matching(written?: Written): Matching {
    return { kind: this.#kind, by: this.#variables, written };
  }

  /** `declared` with the types given in place, and each parameter left made its variable. */
  #prepared(declared: Type): Type {
    return this.#variables.freshened(declared, this.#givenTypes());
  }

  /** The type given for `parameter`, written or by a receiver, if any. */
  #givenOf(parameter: ParameterKey): Type | undefined {
    const variable = this.#variables.variableOf(parameter);
    return variable === undefined ? undefined : this.#system.givenOf(variable);
  }

  /** The types given, by parameter. */
  #givenTypes(): Map<ParameterKey, Type> {
    const given = new Map<ParameterKey, Type>();
    for (const parameter of this.#parameters) {
      const type = this.#givenOf(parameter);
      if (type !== undefined) {
        given.set(parameter, type);
      }
    }
    return given;
  }
}
