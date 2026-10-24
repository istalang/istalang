/**
 * Inferring type arguments (§3.5): matching the types a call or literal gives against the types its
 * declaration takes, which mention the type parameters still to be found.
 *
 * - Matching is exact, except at the top of a match, where a `T` may fill a `T?` (§2): the wrap
 *   applies to a whole value, never inside a collection or a function type.
 * - The types found for a parameter must agree, whatever order the arguments come in: a later
 *   one fits the bound type (a wrap included), or the bound type fits it, which then binds, so
 *   `same(o, 2)` and `same(2, o)` both bind `T` to `int?` for `o: int?`. Two types neither fits
 *   conflict, and inference fails for that parameter.
 * - The error type and `never` fit anything and bind nothing, so one mistake is reported once.
 */

import { type OptionalEntity, optionalInner, wrapsToFit } from '../types/fit.ts';
import {
  isPrimitive,
  type ParameterKey,
  type Substitution,
  sameType,
  substitute,
  type Type,
  typeChildren,
} from '../types/type.ts';

export class Inference {
  readonly #unknowns: ReadonlySet<ParameterKey>;
  readonly #optional: OptionalEntity;
  readonly #bound = new Map<ParameterKey, Type>();
  readonly #conflicts = new Set<ParameterKey>();

  constructor(unknowns: Iterable<ParameterKey>, optional: OptionalEntity, known?: Substitution) {
    this.#unknowns = new Set(unknowns);
    this.#optional = optional;
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
    const inner = optionalInner(declared, this.#optional);
    return inner !== undefined && this.match(inner, given);
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
        return (
          given.kind === 'function' &&
          given.isAsync === declared.isAsync &&
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
      case 'primitive':
      case 'error':
        return sameType(declared, given) || declared.kind === 'error';
      default: {
        const unhandled: never = declared;
        return unhandled;
      }
    }
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
    if (wrapsToFit(given, current, this.#optional) !== undefined) {
      return true;
    }
    if (wrapsToFit(current, given, this.#optional) !== undefined) {
      this.#bound.set(parameter, given);
      return true;
    }
    this.#conflicts.add(parameter);
    return false;
  }
}
