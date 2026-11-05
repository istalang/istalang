/**
 * Inferring type arguments (§3.5): matching the types a call or literal gives against the types its
 * declaration takes, which mention the type parameters still to be found.
 *
 * - Matching is exact, except at the top of a match, where a `T` may fill a `T?` (§2), a plain
 *   function an async one (§3.14), a one-element tuple and its element each other (§3.15), and a
 *   nominal struct's fields a shape, `T` of `{ x: T, y: T }` bound to `Int` by a `Pixel` (§3.1, §3.5):
 *   a conversion applies to a whole value, never inside a collection or a function type.
 * - A type argument written is taken as given: what is matched has it in place before matching, so
 *   `f<Int?>(o)` for `fn f<T>(x: T?)` matches `Int?` against `Int?`, never `T` against what `None`
 *   leaves. Whether it stands for a member parameter is instantiation's to check
 *   (types/member-arguments.ts).
 * - A pack binds only what can stand for one, a tuple, `Unit` or a pack (§3.5); a function type's
 *   pack binds to the parameters past the fixed ones (types/type.ts, `sameShape`).
 * - A shape matches a shape of the same field names, field by field, in the name order both keep.
 * - The types found for a parameter must agree, whatever order the arguments come in: a later
 *   one fits the bound type (a conversion included), or the bound type fits it, which then binds, so
 *   `same(o, 2)` and `same(2, o)` both bind `T` to `Int?` for `o: Int?`. Two types neither fits
 *   conflict, and inference fails for that parameter.
 * - Only the top of a match converts. Anywhere else, inside a type or where a value must have its
 *   type exactly (a reference, a spread's items, a witness), the type found is the parameter's
 *   own: a bound type there must be the same, and once found there it never widens, so
 *   `set(o, &n)` and `set(&n, o)` conflict for `n: Int`, as a wrapped `n` couldn't be its place.
 * - A member parameter (`T in U`, §3.5) is filled only by a type that is one member of `U`, after
 *   the parameters `U` mentions are found: a literal argument gives its literal type where `U`
 *   holds literals of its base (`literalType`), a literal type of a member's base gives that base,
 *   and a value of several members fills nothing, which is noted (`severalMembers`): the caller
 *   narrows it first. A union is never found otherwise than from what is given.
 * - The error type fits anything and binds nothing while matching, so one mistake is reported
 *   once: a parameter it met and nothing else bound is the error type once the expected result and
 *   defaults have had their say (complete.ts, `bindErrorWhereOpen`), never one inference failed for.
 *   `Never` fits anything too and binds nothing while matching; a parameter it alone met where a
 *   value must have its type exactly is `Never` only once the expected result and defaults have had
 *   their say (`bindNeverWhereOpen`), as `expectPanic(fn(): panic("x"))` needs.
 */

import { type Fitting, fitOf, matchConversion } from '../types/fit.ts';
import { fillsPack, functionFits, isPack } from '../types/function-types.ts';
import { sameType } from '../types/identity.ts';
import { isOneMember } from '../types/member-arguments.ts';
import { parameterType } from '../types/resolve-type.ts';
import { type Substitution, substitute } from '../types/substitution.ts';
import {
  type AnonymousStructType,
  type AnyType,
  errorType,
  type FunctionType,
  isPrimitive,
  type LiteralValue,
  neverType,
  type ParameterKey,
  type Type,
  type UnionType,
} from '../types/type.ts';
import { typeChildren } from '../types/type-children.ts';
import { parametersIn } from '../types/type-parts.ts';
import { baseOf } from '../types/union-members.ts';
import { literalOrBase, membersOf, unionOf, unionOfNormalized } from '../types/unions.ts';

export class Inference {
  readonly #unknowns: ReadonlySet<ParameterKey>;
  readonly #fitting: Fitting;
  readonly #bound = new Map<ParameterKey, Type>();
  /** The parameters a type was found for where it must be theirs exactly, which never widen. */
  readonly #pinned = new Set<ParameterKey>();
  readonly #conflicts = new Set<ParameterKey>();
  /** The parameters `Never` met where a value must have its type exactly. */
  readonly #metNever = new Set<ParameterKey>();
  /** The parameters the error type met. */
  readonly #metError = new Set<ParameterKey>();
  readonly #severalMembers = new Map<ParameterKey, Type>();
  /** The type arguments written for some of the parameters, in place in whatever is matched. */
  readonly #written: Substitution;

  /** `written` gives the type arguments written for some of `unknowns`, taken as given (§3.5). */
  constructor(unknowns: Iterable<ParameterKey>, fitting: Fitting, written?: Substitution) {
    this.#unknowns = new Set(unknowns);
    this.#fitting = fitting;
    this.#written = written ?? new Map();
    for (const [parameter, type] of this.#written) {
      this.#bound.set(parameter, type);
    }
  }

  /** Matches a declared type against a given one, binding what it can; whether they fit. */
  match(declared: Type, given: Type): boolean {
    this.#meetError(declared, given);
    return (
      matchConversion(given, substitute(declared, this.#written, this.#fitting), {
        ...this.#fitting,
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
    const known = this.substituted(declared);
    if (known.kind !== 'any' || parametersIn(known).some((each) => this.#unknowns.has(each))) {
      return false;
    }
    return this.#fitting.meetsAny(given, known);
  }

  /** Matches `declared` against a type `given` must equal, as an expected result. */
  matchExactly(declared: Type, given: Type): boolean {
    return this.#matchExact(substitute(declared, this.#written, this.#fitting), given);
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

  /** Binds the error type to each parameter it met, once nothing else is left to bind it. */
  bindErrorWhereOpen(): void {
    for (const parameter of this.#metError) {
      this.bindIfOpen(parameter, errorType);
    }
  }

  /** Binds `Never` to each parameter only `Never` met, once nothing else is left to bind it. */
  bindNeverWhereOpen(): void {
    for (const parameter of this.#metNever) {
      this.bindIfOpen(parameter, neverType);
    }
  }

  /** The parameters two different types were found for. */
  get conflicts(): ReadonlySet<ParameterKey> {
    return this.#conflicts;
  }

  /** The member parameters given a value of several members of their union, by what was given. */
  get severalMembers(): ReadonlyMap<ParameterKey, Type> {
    return this.#severalMembers;
  }

  /**
   * The type a literal of `value` has where `declared` is expected (§2, §3.5): its literal type
   * where a literal type of its base is expected, or a union holding one, or a member parameter
   * whose union holds one; its base otherwise.
   */
  literalType(value: LiteralValue, declared: Type): Type {
    const expected = this.substituted(declared);
    const taking = membersOf(expected).flatMap((member) => {
      const union = this.#memberUnionOf(member);
      return union === undefined ? [member] : membersOf(this.substituted(union));
    });
    return literalOrBase(value, unionOf(taking, this.#fitting));
  }

  /** What has been found so far, as a substitution. */
  substitution(): Substitution {
    return this.#bound;
  }

  /** `declared` with what has been found so far substituted. */
  substituted(declared: Type): Type {
    return substitute(declared, this.#bound, this.#fitting);
  }

  /** Matches at the top of a match, where a parameter's type converts and may widen. */
  #matchAtTop(declared: Type, given: Type): boolean {
    if (givesNothing(declared)) {
      return true;
    }
    return declared.kind === 'parameter' &&
      this.#unknowns.has(declared.declaration) &&
      given.kind !== 'error'
      ? this.#bindLoosely(declared.declaration, given)
      : this.#matchExact(declared, given);
  }

  #matchExact(declared: Type, given: Type): boolean {
    this.#meetError(declared, given);
    if (given.kind === 'error' || givesNothing(declared)) {
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
          sameFieldNames(declared, given) &&
          this.#matchAll(typeChildren(declared), typeChildren(given))
        );
      case 'tuple':
        return given.kind === 'tuple' && this.#matchAll(declared.elements, given.elements);
      case 'function':
        return given.kind === 'function' && this.#matchFunction(declared, given);
      case 'any':
        return given.kind === 'any' && this.#matchConstraints(declared, given);
      case 'union':
        return this.#matchUnion(declared, given);
      case 'associated':
      case 'field':
      case 'keys':
      case 'mapped':
      case 'match':
      case 'recursive':
        // Opaque: what it stands for is known only once its parameters are (§3.5), and inference
        // never goes through it (§3.5, §3.17).
        return (
          parametersIn(declared).some((each) => this.#unknowns.has(each)) ||
          sameType(declared, given)
        );
      case 'primitive':
      case 'literal':
      case 'error':
        return sameType(declared, given) || declared.kind === 'error';
      default: {
        const unhandled: never = declared;
        return unhandled;
      }
    }
  }

  /**
   * Matches a union against a type it must equal (§3.5): the members it writes without a type
   * parameter take theirs among `given`'s, and its one member with type parameters takes what is
   * left. Where nothing is, it binds nothing, so `none` given for a `T?` leaves `T` to be found
   * elsewhere. A union whose members with type parameters are several takes what is left only
   * member by member, in the order written.
   */
  #matchUnion(declared: UnionType, given: Type): boolean {
    const open = declared.members.filter((member) => this.#mentionsUnknown(member));
    const fixed = declared.members.filter((member) => !this.#mentionsUnknown(member));
    const givenMembers = membersOf(given);
    if (!fixed.every((member) => givenMembers.some((each) => sameType(each, member)))) {
      return false;
    }
    const left = givenMembers.filter((each) => !fixed.some((member) => sameType(each, member)));
    if (left.length === 0) {
      return true;
    }
    const [only] = open;
    if (open.length <= 1) {
      return only !== undefined && this.#matchExact(only, unionOfNormalized(left));
    }
    return (
      open.length === left.length &&
      open.every((member, index) => {
        const other = left[index];
        return other !== undefined && this.#matchExact(member, other);
      })
    );
  }

  /** Whether `type` mentions a type parameter this inference is finding. */
  #mentionsUnknown(type: Type): boolean {
    return parametersIn(type).some((parameter) => this.#unknowns.has(parameter));
  }

  #matchFunction(declared: FunctionType, given: FunctionType): boolean {
    return functionFits(
      declared,
      given,
      (part, other) => this.#matchExact(part, other),
      (part, other) => this.#matchExact(part, other) || isPrimitive(other, 'Never'),
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

  /** Notes the parameters to find that `declared` mentions when `given` is the error type. */
  #meetError(declared: Type, given: Type): void {
    if (given.kind === 'error') {
      for (const parameter of parametersIn(declared)) {
        if (this.#unknowns.has(parameter)) {
          this.#metError.add(parameter);
        }
      }
    }
  }

  /** Binds `parameter` where `given` converts into it: it fits the type bound, a conversion included. */
  #bindLoosely(parameter: ParameterKey, given: Type): boolean {
    const filling = this.#filling(parameter, given);
    return (
      filling !== undefined &&
      this.#bind(parameter, filling, (bound) => fitOf(filling, bound, this.#fitting) !== undefined)
    );
  }

  /**
   * What `given` fills `parameter` with: itself, unless `parameter` is a member parameter (§3.5),
   * which only one member of its union fills (types/member-arguments.ts `isOneMember`): `given`,
   * or a literal of a member's base as that base. Undefined when nothing fills it, `given` holding
   * several members noted as such.
   */
  #filling(parameter: ParameterKey, given: Type): Type | undefined {
    const declared = this.#fitting.memberUnionOf({ kind: 'parameter', declaration: parameter });
    if (declared === undefined || given.kind === 'error' || isPrimitive(given, 'Never')) {
      return given;
    }
    const union = this.substituted(declared);
    const memberOf = (type: Type) =>
      [type, baseOf(type)].find((each) => isOneMember(union, each, this.#fitting.memberUnionOf));
    const members = membersOf(given).map(memberOf);
    const [only] = members;
    if (members.length === 1 || only === undefined) {
      return only;
    }
    if (members.every((member) => member !== undefined)) {
      this.#severalMembers.set(parameter, given);
    }
    return undefined;
  }

  /** The union `type` stands for one member of, when it is a member parameter. */
  #memberUnionOf(type: Type): Type | undefined {
    return type.kind === 'parameter' ? this.#fitting.memberUnionOf(type) : undefined;
  }

  /**
   * Binds `parameter` where `given` is its type exactly, pinning it: the type bound is the same.
   * `Never` fits whatever is bound, so it binds nothing, but is noted for completion.
   */
  #bindExactly(parameter: ParameterKey, given: Type): boolean {
    if (isPrimitive(given, 'Never') && !isPack(parameterType(parameter))) {
      this.#metNever.add(parameter);
      return true;
    }
    const filling = this.#filling(parameter, given);
    if (filling === undefined) {
      return false;
    }
    const isBound = this.#bind(parameter, filling, (bound) => sameType(filling, bound));
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
    if (isPack(parameterType(parameter)) && !fillsPack(given)) {
      return false;
    }
    const bound = this.#bound.get(parameter);
    if (bound === undefined) {
      this.#bound.set(parameter, given);
      return true;
    }
    const current = this.substituted(bound);
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

/** Whether two shapes name the same fields; both keep them in name order (types/type.ts). */
function sameFieldNames(first: AnonymousStructType, second: AnonymousStructType): boolean {
  return (
    first.fields.length === second.fields.length &&
    first.fields.every((field, index) => field.name === second.fields[index]?.name)
  );
}

/**
 * Whether inference learns nothing from `declared`: a type written as an associated type
 * (`Field<T>.Data`), which inference never looks through (§3.5); a value is still fitted to it.
 */
function givesNothing(declared: Type): boolean {
  return declared.alias?.kind === 'associated';
}
