/**
 * Equality while inferring (§8.1): where a value must have a type exactly (invariant, `&`, a
 * spread's items, a pack, a witness), a declared type and a given one must be the very same, and
 * each variable the declared one holds is bound to what stands in its place (infer.ts).
 *
 * - A union matches as its members do: those written without a variable take theirs among the
 *   given ones, and its one member with variables takes what is left, so `none` given for a `T?`
 *   leaves `T` to be found elsewhere. Several members with variables take what is left member by
 *   member, in the order written.
 * - A recursive type is matched as what it unfolds to, on either side, a pair met again holding
 *   (types/identity/unfolding-pairs.ts).
 * - A type standing for what its parameters make it (an associated type, a field, keys, a mapped
 *   type, a type `match`) tells nothing while one is to be found, and is matched as it is after.
 * - The error type matches anything and binds nothing, noted for the variables it met.
 * - Either side may hold the variables: a call's result holds them where it is matched against the
 *   type expected of it, and a joined call's where it is passed (design.md §4); a variable either
 *   side is takes the other side.
 */

import { sameType } from '../identity/identity.ts';
import type { UnfoldingPairs } from '../identity/unfolding-pairs.ts';
import { typeChildren } from '../parts/type-children.ts';
import { parametersIn } from '../parts/type-parts.ts';
import { isComputed } from '../type/computed-types.ts';
import { functionFits } from '../type/function-types.ts';
import type { AnonymousStructType, AnyType, ParameterKey, Type, UnionType } from '../type/index.ts';
import { membersOf } from '../type/index.ts';
import { isPrimitive } from '../type/primitives.ts';
import { unionOfNormalized } from '../unions/unions.ts';

/** What matching for equality needs of the inference it serves. */
interface Equating {
  readonly unfolding: UnfoldingPairs;
  readonly isUnknown: (parameter: ParameterKey) => boolean;
  /** Binds `parameter` exactly to `type`; whether its bounds agree. */
  readonly bind: (parameter: ParameterKey, type: Type) => boolean;
  /** Notes the variables `declared` mentions, the error type given where it stands. */
  readonly meetError: (declared: Type) => void;
}

/** Whether `declared` and `given` are the same type, binding `declared`'s variables. */
export function equalTypes(declared: Type, given: Type, equating: Equating): boolean {
  if (given.kind === 'error') {
    equating.meetError(declared);
    return true;
  }
  if (givesNothing(declared)) {
    return true;
  }
  const mentionsUnknown = (type: Type) => parametersIn(type).some(equating.isUnknown);
  if (!mentionsUnknown(declared) && mentionsUnknown(given)) {
    // Equality is symmetric: the side holding the variables is matched as the declared one, as the
    // expected type matches a result's (infer.ts `expect`).
    return equalTypes(given, declared, equating);
  }
  if (declared.kind === 'recursive' || given.kind === 'recursive') {
    return equating.unfolding.relate(declared, given, true, (unfoldedDeclared, unfoldedGiven) =>
      equalTypes(unfoldedDeclared, unfoldedGiven, equating),
    );
  }
  if (declared.kind === 'parameter' && equating.isUnknown(declared.declaration)) {
    // A variable is equal to itself, which bounds it by nothing.
    return (
      (given.kind === 'parameter' && given.declaration === declared.declaration) ||
      equating.bind(declared.declaration, given)
    );
  }
  if (given.kind === 'parameter' && equating.isUnknown(given.declaration)) {
    return equating.bind(given.declaration, declared);
  }
  if (isComputed(declared)) {
    return mentionsUnknown(declared) || sameType(declared, given);
  }
  return declared.kind === 'union'
    ? equalUnion(declared, given, equating)
    : equalParts(declared, given, equating);
}

/** Whether `declared`, built of other types or none, is `given`, part by part. */
function equalParts(declared: Type, given: Type, equating: Equating): boolean {
  const all = (declaredParts: readonly Type[], givenParts: readonly Type[]) =>
    declaredParts.length === givenParts.length &&
    declaredParts.every((part, index) => {
      const other = givenParts[index];
      return other !== undefined && equalTypes(part, other, equating);
    });
  switch (declared.kind) {
    case 'nominal':
      return (
        given.kind === 'nominal' &&
        given.entity === declared.entity &&
        all(declared.arguments, given.arguments)
      );
    case 'anonymous':
      return (
        given.kind === 'anonymous' &&
        sameFieldNames(declared, given) &&
        all(typeChildren(declared), typeChildren(given))
      );
    case 'tuple':
      return given.kind === 'tuple' && all(declared.elements, given.elements);
    case 'function':
      return (
        given.kind === 'function' &&
        functionFits(declared, given, {
          parts: (part, other) => equalTypes(part, other, equating),
          results: (part, other) =>
            equalTypes(part, other, equating) || isPrimitive(other, 'Never'),
          marks: (mark, other) => equalTypes(mark, other, equating),
          sends: (send, other) => equalTypes(send, other, equating),
        })
      );
    case 'any':
      return given.kind === 'any' && equalConstraints(declared, given, all);
    default:
      return sameType(declared, given) || declared.kind === 'error';
  }
}

/** A union matched against a type it must equal, as the banner says. */
function equalUnion(declared: UnionType, given: Type, equating: Equating): boolean {
  const mentionsUnknown = (member: Type) => parametersIn(member).some(equating.isUnknown);
  const open = declared.members.filter(mentionsUnknown);
  const fixed = declared.members.filter((member) => !mentionsUnknown(member));
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
    return only !== undefined && equalTypes(only, unionOfNormalized(left), equating);
  }
  return (
    open.length === left.length &&
    open.every((member, index) => {
      const other = left[index];
      return other !== undefined && equalTypes(member, other, equating);
    })
  );
}

/** Each of `declared`'s constraints matched by one of `given`'s, a set like it (§8.2). */
function equalConstraints(
  declared: AnyType,
  given: AnyType,
  all: (declared: readonly Type[], given: readonly Type[]) => boolean,
): boolean {
  return (
    given.constraints.length === declared.constraints.length &&
    declared.constraints.every((constraint) =>
      given.constraints.some(
        (other) => other.trait === constraint.trait && all(constraint.arguments, other.arguments),
      ),
    )
  );
}

/** Whether two shapes name the same fields; both keep them in name order (types/type/index.ts). */
function sameFieldNames(first: AnonymousStructType, second: AnonymousStructType): boolean {
  return (
    first.fields.length === second.fields.length &&
    first.fields.every((field, index) => field.name === second.fields[index]?.name)
  );
}

/**
 * Whether inference learns nothing from `declared`: a type written as an associated type
 * (`Field<T>.Data`), which inference never looks through (§8.1); a value is still fitted to it.
 */
export function givesNothing(declared: Type): boolean {
  return declared.alias?.kind === 'associated';
}
