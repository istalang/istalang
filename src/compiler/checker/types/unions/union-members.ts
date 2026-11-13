/**
 * The rules that normalize a union's members (§2), in one home for every union built: `unionOf`
 * (unions.ts) over types, and the term graph of recursive types (identity/recursive-terms.ts) over
 * its slots, whose members only flattening brings together. Each reads its members through a
 * `MemberReading`, so the rules never depend on how a member is held.
 *
 * - The error type makes the whole union the error type: a diagnostic already explained it.
 * - A union is a set of members: duplicates merge by key, `Never` drops out.
 * - No value sits in two members: a literal merges into its base where the base is a member,
 *   `true | false` is `Bool`, and an `any` member takes whole every member meeting its traits, or
 *   whose literals' base does, as the program's rules say (../type/type-rules.ts).
 */

import type { AnyType, LiteralValue, Type } from '../type/index.ts';
import { isPrimitive, primitiveType } from '../type/primitives.ts';
import type { TypeRules } from '../type/type-rules.ts';

/** The primitive a literal's value is a value of. */
type LiteralBase = 'Int' | 'String' | 'Bool';

/** The base type of a literal of `value`: `Int`, `String` or `Bool`. */
export function literalBase(value: LiteralValue): LiteralBase {
  switch (typeof value) {
    case 'bigint':
      return 'Int';
    case 'string':
      return 'String';
    default:
      return 'Bool';
  }
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

/** What the rules of a program say about members of a union (../type/type-rules.ts). */
export type MemberRules = Pick<TypeRules, 'absorbs'>;

/** How members of a union are read: each one's type and key, and the member a type merges to. */
export interface MemberReading<Member> {
  readonly typeOf: (member: Member) => Type;
  readonly keyOf: (member: Member) => string;
  /** The member standing for `type`, which merging builds (`Bool` for `true | false`). */
  readonly memberOf: (type: Type) => Member;
}

/**
 * `members`, flattened already, normalized as a union's (the banner): the first error member alone,
 * else every member distinct, with no value in two of them, in the order given.
 */
export function normalizedMembers<Member>(
  members: readonly Member[],
  reading: MemberReading<Member>,
  rules: MemberRules,
): readonly Member[] {
  const error = members.find((member) => reading.typeOf(member).kind === 'error');
  if (error !== undefined) {
    return [error];
  }
  const merged = mergedLiterals(distinctMembers(members, reading), reading);
  if (!merged.some((member) => reading.typeOf(member).kind === 'any')) {
    return merged;
  }
  const types = merged.map(reading.typeOf);
  return merged.filter(
    (member) => absorbingMember(types, reading.typeOf(member), rules) === undefined,
  );
}

/** `members` without `Never` and without a member another one is, by key. */
function distinctMembers<Member>(
  members: readonly Member[],
  reading: MemberReading<Member>,
): readonly Member[] {
  const keys = new Set<string>();
  return members.filter((member) => {
    const key = reading.keyOf(member);
    if (isPrimitive(reading.typeOf(member), 'Never') || keys.has(key)) {
      return false;
    }
    keys.add(key);
    return true;
  });
}

/**
 * Distinct `members` with each literal merged into its base where it is a member, `true | false`
 * into `Bool`.
 */
function mergedLiterals<Member>(
  members: readonly Member[],
  reading: MemberReading<Member>,
): readonly Member[] {
  const types = members.map(reading.typeOf);
  const bases = new Set(types.flatMap((type) => (type.kind === 'primitive' ? [type.name] : [])));
  const bools = new Set(types.flatMap((type) => (type.kind === 'literal' ? [type.value] : [])));
  const hasBool = bools.has(true) && bools.has(false);
  return members.flatMap((member): Member[] => {
    const type = reading.typeOf(member);
    if (type.kind !== 'literal') {
      return [member];
    }
    const base = literalBase(type.value);
    if (bases.has(base)) {
      return [];
    }
    if (base === 'Bool' && hasBool) {
      return type.value === true ? [reading.memberOf(primitiveType('Bool'))] : [];
    }
    return [member];
  });
}

/**
 * The `any` type among `members` that takes `member` whole (§2), as `rules` say: one whose every
 * constraint `member` meets, or its literal's base does; undefined for an `any` type itself, which
 * stays a member of its own, and for a type none takes.
 */
export function absorbingMember(
  members: readonly Type[],
  member: Type,
  rules: MemberRules,
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
