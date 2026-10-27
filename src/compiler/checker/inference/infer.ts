/**
 * Inferring type arguments (§3.5): matching the types a call or literal gives against the types its
 * declaration takes, which mention the type parameters still to be found.
 *
 * - Matching is exact, except at the top of a match, where a `T` may fill a `T?` (§2): the wrap
 *   applies to a whole value, never inside a collection or a function type.
 * - The types found for a parameter must agree, whatever order the arguments come in: a later
 *   one fits the bound type (a conversion included), or the bound type fits it, which then binds, so
 *   `same(o, 2)` and `same(2, o)` both bind `T` to `int?` for `o: int?`. Two types neither fits
 *   conflict, and inference fails for that parameter.
 * - The error type and `never` fit anything and bind nothing, so one mistake is reported once.
 */

import { type Fitting, fitOf, optionalInner } from '../types/fit.ts';
import {
  type AnyType,
  type FunctionType,
  isPrimitive,
  type ParameterKey,
  parametersIn,
  type Substitution,
  sameType,
  substitute,
  type Type,
  typeChildren,
} from '../types/type.ts';

export class Inference {
  readonly #unknowns: ReadonlySet<ParameterKey>;
  readonly #fitting: Fitting;
  readonly #bound = new Map<ParameterKey, Type>();
  readonly #conflicts = new Set<ParameterKey>();

  constructor(unknowns: Iterable<ParameterKey>, fitting: Fitting, known?: Substitution) {
    this.#unknowns = new Set(unknowns);
    this.#fitting = fitting;
    for (const [parameter, type] of known ?? []) {
      this.#bound.set(parameter, type);
    }
  }

  /** Matches a declared type against a given one, binding what it can; whether they fit. */
  match(declared: Type, given: Type): boolean {
    if (given.kind === 'error' || isPrimitive(given, 'never')) {
      return true;
    }
    if (this.#matchExact(declared, given)) {
      return true;
    }
    if (declared.kind === 'any') {
      return this.#convertsInto(declared, given);
    }
    const inner = optionalInner(declared, this.#fitting.optional);
    return inner !== undefined && this.match(inner, given);
  }

  /**
   * Whether `given` converts into `declared`, an `any` type: one whose parameters are all known,
   * since conversion binds none (§3.10).
   */
  #convertsInto(declared: AnyType, given: Type): boolean {
    const known = substitute(declared, this.#bound);
    if (known.kind !== 'any' || parametersIn(known).some((each) => this.#unknowns.has(each))) {
      return false;
    }
    return this.#fitting.meetsAny(given, known);
  }

  /** Matches `declared` against a type `given` must equal, as an expected result. */
  matchExactly(declared: Type, given: Type): boolean {
    return given.kind === 'error' || this.#matchExact(declared, given);
  }

  /** Whether `parameter` is one this inference is finding. */
  isUnknown(parameter: ParameterKey): boolean {
    return this.#unknowns.has(parameter);
  }

  /** The type bound to `parameter` so far. */
  boundOf(parameter: ParameterKey): Type | undefined {
    return this.#bound.get(parameter);
  }

  /** Binds `parameter` to `type` if nothing has, as a default does. */
  bindIfOpen(parameter: ParameterKey, type: Type): void {
    if (!this.#bound.has(parameter)) {
      this.#bound.set(parameter, type);
    }
  }

  /** The parameters two different types were found for. */
  get conflicts(): ReadonlySet<ParameterKey> {
    return this.#conflicts;
  }

  /** What has been found so far, as a substitution. */
  substitution(): Substitution {
    return this.#bound;
  }

  #matchExact(declared: Type, given: Type): boolean {
    if (given.kind === 'error') {
      return true;
    }
    switch (declared.kind) {
      case 'parameter':
        return this.#unknowns.has(declared.declaration)
          ? this.#bind(declared.declaration, given)
          : sameType(declared, given);
      case 'nominal':
        return (
          given.kind === 'nominal' &&
          given.entity === declared.entity &&
          this.#matchAll(declared.arguments, given.arguments)
        );
      case 'anonymous':
        return (
          given.kind === 'anonymous' &&
          given.origin === declared.origin &&
          this.#matchAll(typeChildren(declared), typeChildren(given))
        );
      case 'tuple':
        return given.kind === 'tuple' && this.#matchAll(declared.elements, given.elements);
      case 'function':
        return given.kind === 'function' && this.#matchFunction(declared, given);
      case 'any':
        return given.kind === 'any' && this.#matchConstraints(declared, given);
      case 'primitive':
      case 'error':
        return sameType(declared, given) || declared.kind === 'error';
      default: {
        const unhandled: never = declared;
        return unhandled;
      }
    }
  }

  #matchFunction(declared: FunctionType, given: FunctionType): boolean {
    return (
      given.isAsync === declared.isAsync &&
      (given.isSendable || !declared.isSendable) &&
      given.parameters.length === declared.parameters.length &&
      declared.parameters.every((parameter, index) => {
        const other = given.parameters[index];
        return (
          other !== undefined &&
          other.reference === parameter.reference &&
          this.#matchExact(parameter.type, other.type)
        );
      }) &&
      this.#matchExact(declared.result, given.result)
    );
  }

  /** Each of `declared`'s constraints matched by one of `given`'s, a set like it (§3.10). */
  #matchConstraints(declared: AnyType, given: AnyType): boolean {
    return (
      given.constraints.length === declared.constraints.length &&
      declared.constraints.every((constraint) =>
        given.constraints.some(
          (other) =>
            other.trait === constraint.trait &&
            this.#matchAll(constraint.arguments, other.arguments),
        ),
      )
    );
  }

  #matchAll(declared: readonly Type[], given: readonly Type[]): boolean {
    return (
      declared.length === given.length &&
      declared.every((type, index) => {
        const other = given[index];
        return other !== undefined && this.#matchExact(type, other);
      })
    );
  }

  #bind(parameter: ParameterKey, given: Type): boolean {
    const bound = this.#bound.get(parameter);
    if (bound === undefined) {
      this.#bound.set(parameter, given);
      return true;
    }
    const current = substitute(bound, this.#bound);
    if (fitOf(given, current, this.#fitting) !== undefined) {
      return true;
    }
    if (fitOf(current, given, this.#fitting) !== undefined) {
      this.#bound.set(parameter, given);
      return true;
    }
    this.#conflicts.add(parameter);
    return false;
  }
}
