/**
 * Inferring type arguments (§3.5): matching the types a call or literal gives against the types its
 * declaration takes, which mention the type parameters still to be found.
 *
 * - Matching is exact, except at the top of a match, where a `T` may fill a `T?` (§2), a plain
 *   function an async one (§3.14), and a one-element tuple and its element each other (§3.15): a
 *   conversion applies to a whole value, never inside a collection or a function type.
 * - A pack binds only what can stand for one, a tuple, `unit` or a pack (§3.5); a function type's
 *   pack binds to the parameters past the fixed ones (types/type.ts, `sameShape`).
 * - The types found for a parameter must agree, whatever order the arguments come in: a later
 *   one fits the bound type (a conversion included), or the bound type fits it, which then binds, so
 *   `same(o, 2)` and `same(2, o)` both bind `T` to `int?` for `o: int?`. Two types neither fits
 *   conflict, and inference fails for that parameter.
 * - Only the top of a match converts. Anywhere else, inside a type or where a value must have its
 *   type exactly (a reference, a spread's items, a witness), the type found is the parameter's
 *   own: a bound type there must be the same, and once found there it never widens, so
 *   `set(o, &n)` and `set(&n, o)` conflict for `n: int`, as a wrapped `n` couldn't be its place.
 * - The error type fits anything and binds nothing, so one mistake is reported once. `never` fits
 *   anything too and binds nothing while matching; a parameter it alone met where a value must
 *   have its type exactly is `never` only once the expected result and defaults have had their say
 *   (complete.ts, `bindNeverWhereOpen`), as `expectPanic(fn(): panic("x"))` needs.
 */

import { type Fitting, fitOf, matchConversion } from '../types/fit.ts';
import { type Substitution, substitute } from '../types/substitution.ts';
import {
  type AnyType,
  type FunctionType,
  fillsPack,
  isPrimitive,
  neverType,
  type ParameterKey,
  sameShape,
  sameType,
  type Type,
} from '../types/type.ts';
import { parametersIn, typeChildren } from '../types/type-parts.ts';

export class Inference {
  readonly #unknowns: ReadonlySet<ParameterKey>;
  readonly #fitting: Fitting;
  readonly #bound = new Map<ParameterKey, Type>();
  /** The parameters a type was found for where it must be theirs exactly, which never widen. */
  readonly #pinned = new Set<ParameterKey>();
  readonly #conflicts = new Set<ParameterKey>();
  /** The parameters `never` met where a value must have its type exactly. */
  readonly #metNever = new Set<ParameterKey>();

  constructor(unknowns: Iterable<ParameterKey>, fitting: Fitting, known?: Substitution) {
    this.#unknowns = new Set(unknowns);
    this.#fitting = fitting;
    for (const [parameter, type] of known ?? []) {
      this.#bound.set(parameter, type);
    }
  }

  /** Matches a declared type against a given one, binding what it can; whether they fit. */
  match(declared: Type, given: Type): boolean {
    return (
      matchConversion(given, declared, {
        optional: this.#fitting.optional,
        exact: (target, source) => this.#matchAtTop(target, source),
        meetsAny: (source, target) => this.#convertsInto(target, source),
      }) !== undefined
    );
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

  /** Binds `never` to each parameter only `never` met, once nothing else is left to bind it. */
  bindNeverWhereOpen(): void {
    for (const parameter of this.#metNever) {
      this.bindIfOpen(parameter, neverType);
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

  /** Matches at the top of a match, where a parameter's type converts and may widen. */
  #matchAtTop(declared: Type, given: Type): boolean {
    return declared.kind === 'parameter' &&
      this.#unknowns.has(declared.declaration) &&
      given.kind !== 'error'
      ? this.#bindLoosely(declared.declaration, given)
      : this.#matchExact(declared, given);
  }

  #matchExact(declared: Type, given: Type): boolean {
    if (given.kind === 'error') {
      return true;
    }
    switch (declared.kind) {
      case 'parameter':
        return this.#unknowns.has(declared.declaration)
          ? this.#bindExactly(declared.declaration, given)
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
      sameShape(
        declared,
        given,
        (part, other) => this.#matchExact(part, other),
        (part, other) => this.#matchExact(part, other) || isPrimitive(other, 'never'),
      )
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

  /** Binds `parameter` where `given` converts into it: it fits the type bound, a conversion included. */
  #bindLoosely(parameter: ParameterKey, given: Type): boolean {
    return this.#bind(
      parameter,
      given,
      (bound) => fitOf(given, bound, this.#fitting) !== undefined,
    );
  }

  /**
   * Binds `parameter` where `given` is its type exactly, pinning it: the type bound is the same.
   * `never` fits whatever is bound, so it binds nothing, but is noted for completion.
   */
  #bindExactly(parameter: ParameterKey, given: Type): boolean {
    if (isPrimitive(given, 'never') && !isPack(parameter)) {
      this.#metNever.add(parameter);
      return true;
    }
    const isBound = this.#bind(parameter, given, (bound) => sameType(given, bound));
    if (isBound) {
      this.#pinned.add(parameter);
    }
    return isBound;
  }

  /**
   * Binds `parameter` to `given` unless a type is bound already that `given` agrees with (`agrees`);
   * a bound type `given` widens takes its place unless pinned. Two types neither takes conflict.
   */
  #bind(parameter: ParameterKey, given: Type, agrees: (bound: Type) => boolean): boolean {
    if (isPack(parameter) && !fillsPack(given)) {
      return false;
    }
    const bound = this.#bound.get(parameter);
    if (bound === undefined) {
      this.#bound.set(parameter, given);
      return true;
    }
    const current = substitute(bound, this.#bound);
    if (agrees(current)) {
      return true;
    }
    if (!this.#pinned.has(parameter) && fitOf(current, given, this.#fitting) !== undefined) {
      this.#bound.set(parameter, given);
      return true;
    }
    this.#conflicts.add(parameter);
    return false;
  }
}

function isPack(parameter: ParameterKey): boolean {
  return parameter.kind === 'TypeParameter' && parameter.isPack;
}
