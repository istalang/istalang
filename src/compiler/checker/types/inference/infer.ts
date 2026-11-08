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
 * - The type the call is expected to give bounds its result likewise, but only advises
 *   (bounds.ts); settling rule 2 knows which variables stand at the result's top (`expect`).
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

import type { Fitting } from '../fitting/fit/index.ts';
import { noSubstitution, type Substitution, substitute } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { LiteralType, LiteralValue, ParameterKey, Type } from '../type/index.ts';
import { literalOrBase, membersOf, unionOf } from '../unions/unions.ts';
import type { Settling } from './settle.ts';
import { CallSystem, type MatchKind } from './system.ts';
import { CallVariables } from './variables.ts';

export class Inference {
  readonly #variables: CallVariables;
  readonly #fitting: Fitting;
  readonly #system: CallSystem;
  /** The type arguments written, and those a method's receiver gave, taken as given. */
  readonly #given: Map<ParameterKey, Type>;
  /** What the match being made is, a receiver's matching as an argument's does otherwise. */
  #kind: MatchKind = 'argument';

  /**
   * `written` gives the type arguments written for some of `parameters`, taken as given (§3.5).
   * Each parameter is inferred as a variable of its own (variables.ts).
   */
  constructor(parameters: Iterable<ParameterKey>, fitting: Fitting, written?: Substitution) {
    this.#variables = new CallVariables(parameters, fitting);
    this.#fitting = fitting;
    this.#given = new Map(written ?? noSubstitution);
    this.#system = new CallSystem(this.#variables, fitting, () =>
      this.#variables.byVariable(this.#given),
    );
  }

  /** Matches a value of `given` where `declared` is taken, bounding what it can; whether it fits. */
  match(declared: Type, given: Type): boolean {
    return this.#system.match(this.#prepared(declared), given, this.#kind);
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
      ? this.#system.match(prepared, typed, this.#kind)
      : this.#system.match(prepared, typed, this.#kind, literal);
  }

  /** Matches `declared` against a type `given` must be exactly, as a reference or a spread's. */
  matchExactly(declared: Type, given: Type): boolean {
    return this.#system.matchExactly(this.#prepared(declared), given, this.#kind);
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
          if (equal !== undefined) {
            this.#given.set(parameter, equal.type);
          }
        }
      }
      return matched;
    } finally {
      this.#kind = 'argument';
    }
  }

  /**
   * Bounds the call's `result` by the type it is `expected` to give, which only advises: where
   * the two disagree, nothing is bounded (bounds.ts).
   */
  expect(result: Type, expected: Type | undefined): void {
    if (expected !== undefined) {
      this.#system.expectResult(this.#prepared(result), expected);
    }
  }

  /** Whether `parameter` is one this inference is finding. */
  isUnknown(parameter: ParameterKey): boolean {
    return this.#variables.variableOf(parameter) !== undefined;
  }

  /** The type found for `parameter` so far: given, equal, or what its bounds tell (`tentative`). */
  boundOf(parameter: ParameterKey): Type | undefined {
    const given = this.#given.get(parameter);
    const variable = this.#variables.variableOf(parameter);
    if (given !== undefined || variable === undefined) {
      return given;
    }
    const found = this.#system.tentative(variable);
    return found === undefined ? undefined : this.#variables.restored(found);
  }

  /**
   * `type` with what is settled, and for the rest the expected type's choice where settling rule 2
   * would take it (settle.ts): what a postponed argument's result is expected to be.
   */
  guided(type: Type, settling: Settling): Type {
    const settled = this.settledIn(type);
    const guide = new Map<ParameterKey, Type>();
    for (const parameter of parametersIn(settled)) {
      const variable = this.#variables.variableOf(parameter);
      const choice =
        variable === undefined
          ? undefined
          : this.#system.expectedChoiceFor(variable, this.#variables.settlingFor(settling));
      if (choice !== undefined) {
        guide.set(parameter, this.#variables.restored(choice));
      }
    }
    return substitute(settled, guide, this.#fitting);
  }

  /** Settles `parameters` now, each taken as found from here on (settle.ts). */
  fix(parameters: readonly ParameterKey[], settling: Settling): void {
    for (const parameter of parameters) {
      const variable = this.#variables.variableOf(parameter);
      if (variable !== undefined && !this.#given.has(parameter)) {
        this.#system.fix(variable, this.#variables.settlingFor(settling));
      }
    }
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
    return this.#system.severalMembers;
  }

  /**
   * The type a literal of `value` has where `declared` is expected (§2, §3.5): its literal type
   * where a literal type of its base is expected, or a union holding one, or a member parameter
   * whose union holds one; its base otherwise.
   */
  literalType(value: LiteralValue, declared: Type): Type {
    const expected = this.substituted(declared);
    const taking = membersOf(expected).flatMap((member) => {
      const union = member.kind === 'parameter' ? this.#fitting.memberUnionOf(member) : undefined;
      return union === undefined ? [member] : membersOf(this.substituted(union));
    });
    return literalOrBase(value, unionOf(taking, this.#fitting));
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
      const { equal } = this.#system.boundsOf(variable);
      return equal?.origin === 'argument' ? this.#variables.restored(equal.type) : undefined;
    });
    return substitute(declared, settled, this.#fitting);
  }

  /** The types given, then for each parameter left what `read` finds for it. */
  #found(
    read: (parameter: ParameterKey, variable: ParameterKey) => Type | undefined,
  ): Map<ParameterKey, Type> {
    const found = new Map(this.#given);
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

  /** `declared` with the types given in place, and each parameter left made its variable. */
  #prepared(declared: Type): Type {
    return this.#variables.freshened(declared, this.#given);
  }
}
