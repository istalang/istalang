/**
 * Union and literal types (§2): building a union, which normalizes it, and taking one apart.
 *
 * - A union is a set of members, normalized by the rules every union follows (union-members.ts):
 *   a member that is a union contributes its members, duplicates merge (by key, so an alias and the
 *   type it names are one member), no value sits in two members, and one member is that member,
 *   none `Never`.
 * - A recursive type (§3.17) whose body is a union is flattened: its members join the union, as a
 *   union member's do. A union equal to a recursive type it reaches is that type, written through
 *   its alias (identity/recursive-types.ts `folded`), so `Json | Int` and `Json?` are `Json`.
 * - `unionOf` is the one constructor of a union from types, written, substituted (parts/type-parts.ts:
 *   `T | Int` with `T = Int` collapses, `T | any Stringable` with `T = String` too), joined or made
 *   optional, so normalization holds however a union was reached.
 * - Leaving members of a union out keeps the rest normalized against each other, so what remains
 *   (`unionOfNormalized`), what a `case` leaves to the cases after it, takes no rules.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import { signedNumberOf } from '../../syntax/expressions/numbers.ts';
import { unfolded, unfoldRecursive } from './computed-types.ts';
import { folded } from './identity/recursive-types.ts';
import { typeKeys } from './identity/type-keys.ts';
import { isPrimitive, neverType, noneType } from './primitives.ts';
import { isMemberParameter, type LiteralType, type LiteralValue, type Type } from './type.ts';
import type { TypeRules } from './type-rules.ts';
import {
  absorbingMember,
  baseOf,
  literalBase,
  type MemberReading,
  normalizedMembers,
} from './union-members.ts';

/** The literal type of `value`. */
export function literalType(value: LiteralValue): LiteralType {
  return { kind: 'literal', value };
}

/** Members read as the types they are. */
const typeReading: MemberReading<Type> = {
  typeOf: (type) => type,
  keyOf: (type) => typeKeys.typeKey(type),
  memberOf: (type) => type,
};

/**
 * The union of `members`, normalized (§2) by the program's `rules`; never a union of fewer than two
 * members.
 */
export function unionOf(members: readonly Type[], rules: TypeRules): Type {
  const flat = members.flatMap(memberTypesOf);
  return folded(unionOfNormalized(normalizedMembers(flat, typeReading, rules)));
}

/** The members `type` gives a union: a union's own, and those of the union a recursive type is. */
function memberTypesOf(type: Type): readonly Type[] {
  const value = type.kind === 'recursive' ? unfoldRecursive(type) : type;
  return value.kind === 'union' ? value.members : [type];
}

/**
 * The union of `members`, already normalized against each other: some members of one union, or
 * each of them spelled again as the same type, as leaving members out or dropping aliases gives.
 */
export function unionOfNormalized(members: readonly Type[]): Type {
  const [only] = members;
  return members.length <= 1 ? (only ?? neverType) : { kind: 'union', members };
}

/** The members of `type`: a union's, or the type itself, which a value of it is one of. */
export function membersOf(type: Type): readonly Type[] {
  return type.kind === 'union' ? type.members : [type];
}

/** What remains of `type` without `removed`'s members; `Never` when nothing does. */
function withoutMembers(type: Type, removed: Type): Type {
  const gone = new Set(membersOf(removed).map((member) => typeKeys.typeKey(member)));
  const left = membersOf(type).filter((member) => !gone.has(typeKeys.typeKey(member)));
  return left.length === membersOf(type).length ? type : folded(unionOfNormalized(left));
}

/** Whether `member` is one of `type`'s members. */
export function hasMember(type: Type, member: Type): boolean {
  const key = typeKeys.typeKey(member);
  return membersOf(type).some((each) => typeKeys.typeKey(each) === key);
}

/** `T | None`, which `T?` is (§2), normalized by the program's `rules`. */
export function optionalOf(type: Type, rules: TypeRules): Type {
  return unionOf([type, noneType], rules);
}

/** What `type` holds beside `none` when it is a union holding `None` (`T` of `T?`); else undefined. */
export function optionalInner(type: Type): Type | undefined {
  return type.kind === 'union' && type.members.some((member) => isPrimitive(member, 'None'))
    ? withoutMembers(type, noneType)
    : undefined;
}

/**
 * What a value of `type` is where it isn't `none`, when `type` may hold `none` (§2, §4), as `??`,
 * `?.`, `!` and `case none` test it: a union holding `None`, without it, a recursive type left
 * unfolded, as a value of it is taken apart (`unfolded`); `Never` for `None`
 * itself, whose one value is `none`; or, where an `any` member took `None` whole, `type` itself,
 * `none` being one of the values that member holds. Undefined for a type never holding `none`.
 */
export function presentType(type: Type, rules: TypeRules): Type | undefined {
  if (isPrimitive(type, 'None')) {
    return neverType;
  }
  const inner = optionalInner(type);
  if (inner !== undefined) {
    return unfolded(inner);
  }
  return absorbingMember(membersOf(type), noneType, rules) === undefined ? undefined : type;
}

/** Whether `member` has one value only, a literal's or `none`, so a union's tag alone says it. */
export function hasOneValue(member: Type): boolean {
  return member.kind === 'literal' || isPrimitive(member, 'None');
}

/**
 * The literal type of a literal written in place (§2): a string, a Bool, or an integer, maybe
 * negated; undefined for any other expression.
 */
export function writtenLiteral(node: Expression): LiteralType | undefined {
  if (node.kind === 'StringLiteral' || node.kind === 'BooleanLiteral') {
    return literalType(node.value);
  }
  const number = signedNumberOf(node);
  return number?.kind === 'IntegerLiteral' ? literalType(number.value) : undefined;
}

/**
 * The type a literal of `value` has where `expected` is expected (§2): its literal type where a
 * literal type of its base is expected, or a union holding one, or a member parameter, each of
 * whose instantiations is one member (§3.5), else its base, as `const s = "draft"` makes a
 * `String`.
 */
export function literalOrBase(value: LiteralValue, expected: Type | undefined): Type {
  const literal = literalType(value);
  const base = baseOf(literal);
  const literalExpected = membersOf(expected ?? base).some(
    (member) =>
      isMemberParameter(member) ||
      (member.kind === 'literal' && literalBase(member.value) === literalBase(value)),
  );
  return literalExpected ? literal : base;
}

/**
 * The base a literal type, or a union of literals of one base, widens to, the keys of a struct not
 * known yet being Strings (§3.1); else undefined.
 */
export function literalsBase(type: Type): Type | undefined {
  const bases = membersOf(type).map((member) =>
    member.kind === 'literal' || member.kind === 'keys' ? baseOf(member) : undefined,
  );
  const [first] = bases;
  return first !== undefined &&
    bases.every((base) => base !== undefined && typeKeys.typeKey(base) === typeKeys.typeKey(first))
    ? first
    : undefined;
}
