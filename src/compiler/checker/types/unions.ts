/**
 * Union and literal types (§2): building a union, which normalizes it, and taking one apart.
 *
 * - A union is a set of members: a member that is a union contributes its members, duplicates
 *   merge (by key, so an alias and the type it names are one member), `Never` drops out, and one
 *   member is that member, none `Never`.
 * - No value sits in two members: a literal merges into its base where the base is a member,
 *   `true | false` is `Bool`, and an `any` member takes whole every member meeting its traits, or
 *   whose literals' base does, as the program's rules say (type-rules.ts).
 * - The error type makes the whole union the error type: a diagnostic already explained it.
 * - `unionOf` is the one constructor of a union from types, written, substituted (type-parts.ts:
 *   `T | Int` with `T = Int` collapses, `T | any Stringable` with `T = String` too), joined or made
 *   optional, so normalization holds however a union was reached.
 * - Leaving members of a union out keeps the rest normalized against each other, so what remains
 *   (`unionOfNormalized`), what a `case` leaves to the cases after it, takes no rules.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import { signedNumberOf } from '../../syntax/expressions/numbers.ts';
import {
  type AnyType,
  isMemberParameter,
  isPrimitive,
  type LiteralType,
  type LiteralValue,
  neverType,
  noneType,
  primitiveType,
  type Type,
} from './type.ts';
import { typeKeys } from './type-keys.ts';
import type { TypeRules } from './type-rules.ts';

/** The primitive a literal's value is a value of. */
type LiteralBase = 'Int' | 'String' | 'Bool';

/** The base type of a literal of `value`: `Int`, `String` or `Bool`. */
function literalBase(value: LiteralValue): LiteralBase {
  switch (typeof value) {
    case 'bigint':
      return 'Int';
    case 'string':
      return 'String';
    default:
      return 'Bool';
  }
}

/** The literal type of `value`. */
export function literalType(value: LiteralValue): LiteralType {
  return { kind: 'literal', value };
}

/**
 * The type a value of `type` widens to without a literal type: a literal's base, `String` for the
 * keys of a struct not known yet, each a String literal (§3.1), else itself.
 */
export function baseOf(type: Type): Type {
  if (type.kind === 'keys') {
    return primitiveType('String');
  }
  return type.kind === 'literal' ? primitiveType(literalBase(type.value)) : type;
}

/**
 * The union of `members`, normalized (§2) by the program's `rules`; never a union of fewer than two
 * members.
 */
export function unionOf(members: readonly Type[], rules: TypeRules): Type {
  const flat = members.flatMap((member) => (member.kind === 'union' ? member.members : [member]));
  if (flat.some((member) => member.kind === 'error')) {
    return flat.find((member) => member.kind === 'error') ?? neverType;
  }
  return unionOfNormalized(withoutAbsorbed(mergedLiterals(distinctMembers(flat)), rules));
}

/**
 * The union of `members`, already normalized against each other: some members of one union, or
 * each of them spelled again as the same type, as leaving members out or dropping aliases gives.
 */
export function unionOfNormalized(members: readonly Type[]): Type {
  const [only] = members;
  return members.length <= 1 ? (only ?? neverType) : { kind: 'union', members };
}

/** `members` without `Never` and without a member another one is, by key. */
function distinctMembers(members: readonly Type[]): readonly Type[] {
  const keys = new Set<string>();
  return members.filter((member) => {
    const key = typeKeys.typeKey(member);
    if (isPrimitive(member, 'Never') || keys.has(key)) {
      return false;
    }
    keys.add(key);
    return true;
  });
}

/** Distinct `members` with each literal merged into its base where it is a member, `true | false` into `Bool`. */
function mergedLiterals(members: readonly Type[]): readonly Type[] {
  const keys = new Set(members.map((member) => typeKeys.typeKey(member)));
  const bases = new Set(
    members.flatMap((member) => (member.kind === 'primitive' ? [member.name] : [])),
  );
  const hasBool = keys.has(literalKeyOf(true)) && keys.has(literalKeyOf(false));
  return members.flatMap((member): Type[] => {
    if (member.kind !== 'literal') {
      return [member];
    }
    const base = literalBase(member.value);
    if (bases.has(base)) {
      return [];
    }
    if (base === 'Bool' && hasBool) {
      return member.value === true ? [primitiveType('Bool')] : [];
    }
    return [member];
  });
}

/** `members` without each one an `any` member takes whole, so no value sits in two members. */
function withoutAbsorbed(members: readonly Type[], rules: TypeRules): readonly Type[] {
  if (!members.some((member) => member.kind === 'any')) {
    return members;
  }
  return members.filter((member) => absorbingMember(members, member, rules) === undefined);
}

/**
 * The `any` type among `members` that takes `member` whole (§2), as `rules` say: one whose every
 * constraint `member` meets, or its literal's base does; undefined for an `any` type itself, which
 * stays a member of its own, and for a type none takes.
 */
export function absorbingMember(
  members: readonly Type[],
  member: Type,
  rules: TypeRules,
): AnyType | undefined {
  if (member.kind === 'any') {
    return undefined;
  }
  return members.find(
    (target): target is AnyType =>
      target.kind === 'any' &&
      (rules.absorbs(target, member) || rules.absorbs(target, baseOf(member))),
  );
}

function literalKeyOf(value: LiteralValue): string {
  return typeKeys.typeKey(literalType(value));
}

/** The members of `type`: a union's, or the type itself, which a value of it is one of. */
export function membersOf(type: Type): readonly Type[] {
  return type.kind === 'union' ? type.members : [type];
}

/** What remains of `type` without `removed`'s members; `Never` when nothing does. */
function withoutMembers(type: Type, removed: Type): Type {
  const gone = new Set(membersOf(removed).map((member) => typeKeys.typeKey(member)));
  const left = membersOf(type).filter((member) => !gone.has(typeKeys.typeKey(member)));
  return left.length === membersOf(type).length ? type : unionOfNormalized(left);
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
 * `?.`, `!` and `case none` test it: a union holding `None`, without it; `Never` for `None`
 * itself, whose one value is `none`; or, where an `any` member took `None` whole, `type` itself,
 * `none` being one of the values that member holds. Undefined for a type never holding `none`.
 */
export function presentType(type: Type, rules: TypeRules): Type | undefined {
  if (isPrimitive(type, 'None')) {
    return neverType;
  }
  return (
    optionalInner(type) ??
    (absorbingMember(membersOf(type), noneType, rules) === undefined ? undefined : type)
  );
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

/** The base a literal type, or a union of literals of one base, widens to; else undefined. */
export function literalsBase(type: Type): Type | undefined {
  const bases = membersOf(type).map((member) =>
    member.kind === 'literal' ? baseOf(member) : undefined,
  );
  const [first] = bases;
  return first !== undefined &&
    bases.every((base) => base !== undefined && typeKeys.typeKey(base) === typeKeys.typeKey(first))
    ? first
    : undefined;
}
