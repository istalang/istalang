/**
 * Union and literal types (§2): building a union, which normalizes it, and taking one apart.
 *
 * - A union is a set of members: a member that is a union contributes its members, duplicates
 *   merge (by key, so an alias and the type it names are one member), `Never` drops out, and one
 *   member is that member, none `Never`.
 * - No value sits in two members: a literal merges into its base where the base is a member, and
 *   `true | false` is `Bool`. A member merging into an `any` member whose traits it meets needs the
 *   program to say so, so it is the caller's (`absorbedInto`), done where a written union is
 *   resolved.
 * - The error type makes the whole union the error type: a diagnostic already explained it.
 * - Substitution builds through `unionOf` (type-parts.ts), so `T | Int` with `T = Int` collapses.
 * - `T?` is `T | None`; what remains of a union without some members (`withoutMembers`) is what a
 *   `case` leaves to the cases after it.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import { signedNumberOf } from '../../syntax/expressions/numbers.ts';
import {
  isPrimitive,
  type LiteralType,
  type LiteralValue,
  neverType,
  noneType,
  primitiveType,
  type Type,
} from './type.ts';
import { typeKeys } from './type-keys.ts';

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

/** The type a value of `type` widens to without a literal type: a literal's base, else itself. */
export function baseOf(type: Type): Type {
  return type.kind === 'literal' ? primitiveType(literalBase(type.value)) : type;
}

/** The union of `members`, normalized (§2); never a union of fewer than two members. */
export function unionOf(members: readonly Type[]): Type {
  const flat = members.flatMap((member) => (member.kind === 'union' ? member.members : [member]));
  if (flat.some((member) => member.kind === 'error')) {
    return flat.find((member) => member.kind === 'error') ?? neverType;
  }
  const keys = new Set<string>();
  const distinct = flat.filter((member) => {
    const key = typeKeys.typeKey(member);
    if (isPrimitive(member, 'Never') || keys.has(key)) {
      return false;
    }
    keys.add(key);
    return true;
  });
  const bases = new Set(
    distinct.flatMap((member) => (member.kind === 'primitive' ? [member.name] : [])),
  );
  const hasBool = keys.has(literalKeyOf(true)) && keys.has(literalKeyOf(false));
  const kept = distinct.flatMap((member): Type[] => {
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
  const [only] = kept;
  if (kept.length <= 1) {
    return only ?? neverType;
  }
  return { kind: 'union', members: kept };
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
  return left.length === membersOf(type).length ? type : unionOf(left);
}

/** Whether `member` is one of `type`'s members. */
export function hasMember(type: Type, member: Type): boolean {
  const key = typeKeys.typeKey(member);
  return membersOf(type).some((each) => typeKeys.typeKey(each) === key);
}

/**
 * `members` without each one an `any` member takes whole (§2): a type meeting every constraint of
 * an `any` member is merged into it, as `meets` says, and so is a literal whose base does, so no
 * value sits in two members.
 */
export function absorbedInto(
  members: readonly Type[],
  meets: (member: Type, target: Extract<Type, { readonly kind: 'any' }>) => boolean,
): readonly Type[] {
  const anyMembers = members.filter((member) => member.kind === 'any');
  return members.filter(
    (member) =>
      member.kind === 'any' ||
      member.kind === 'error' ||
      !anyMembers.some(
        (target) =>
          target.kind === 'any' && (meets(member, target) || meets(baseOf(member), target)),
      ),
  );
}

/** `T | None`, which `T?` is (§2). */
export function optionalOf(type: Type): Type {
  return unionOf([type, noneType]);
}

/** What `type` holds beside `none` when it is a union holding `None` (`T` of `T?`); else undefined. */
export function optionalInner(type: Type): Type | undefined {
  return type.kind === 'union' && type.members.some((member) => isPrimitive(member, 'None'))
    ? withoutMembers(type, noneType)
    : undefined;
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
 * literal type of its base is expected, or a union holding one, else its base, as
 * `const s = "draft"` makes a `String`.
 */
export function literalOrBase(value: LiteralValue, expected: Type | undefined): Type {
  const literal = literalType(value);
  const base = baseOf(literal);
  const literalExpected = membersOf(expected ?? base).some(
    (member) => member.kind === 'literal' && literalBase(member.value) === literalBase(value),
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
