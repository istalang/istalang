/**
 * What types say of the literals a value may be (§2, §4), so `==`, `!=` and a literal pattern can
 * be decided before the program runs: a comparison whose sides can't hold a common value is always
 * unequal, and a pattern whose part can't hold its literal never matches (§3.11).
 *
 * - A value's literals are known when it is written as one, or its type is a literal, a union of
 *   literals, or a member parameter (§3.5) ranging over some: each instantiation makes it one of
 *   them. The keys of a struct not known yet may be any name but those its constraint names (§3.1).
 * - Two sides of known literals are equal when both are one literal, and unequal when one is a
 *   literal the other can't hold. A literal, or `none`, against a side whose type is known but
 *   holds no literal set, such as `Int` against `"x"`, is unequal when the two don't compare at
 *   all: a value of that type is never that literal.
 * - A type known only per instantiation (a type parameter, or computed from one) decides nothing,
 *   and neither does `Never`, whose value can't exist, nor the error type, already explained.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import { isOpaque } from './computed-types.ts';
import {
  isMemberParameter,
  isPrimitive,
  type LiteralValue,
  type Type,
  type TypeParameterType,
} from './type.ts';
import { membersOf, writtenLiteral } from './unions.ts';

/** The literals a value may be, when known: some values, and maybe any other name. */
interface KnownLiterals {
  readonly values: readonly LiteralValue[];
  /** Any String but these, for the keys of a struct not known yet; undefined when closed. */
  readonly anyNameBut: readonly string[] | undefined;
}

/** The union a member parameter ranges over (types/fit.ts `memberUnionOf`). */
export type MemberUnionOf = (parameter: TypeParameterType) => Type | undefined;

/** A side of `==`, or a pattern's part and its literal: its type, and the expression giving it. */
export interface ComparedSide {
  readonly type: Type;
  readonly node: Expression | undefined;
}

/**
 * Whether values of `left` and `right` are always (true) or never (false) equal by their types,
 * as the module's banner says; undefined when only running tells. `compare` is whether `==` takes
 * the two sides at all (types/equality.ts `fitEqualSides`).
 */
export function decidedEquality(
  left: ComparedSide,
  right: ComparedSide,
  compare: boolean,
  memberUnionOf: MemberUnionOf,
): boolean | undefined {
  const [ones, others] = [left, right].map((side) => sideLiterals(side, memberUnionOf));
  const byLiterals = decidedEqual(ones, others);
  if (byLiterals !== undefined || compare) {
    return byLiterals;
  }
  const literalAgainstKnown = (
    side: ComparedSide,
    one: KnownLiterals | undefined,
    other: ComparedSide,
  ) =>
    (singleLiteral(one) !== undefined || side.node?.kind === 'NoneLiteral') && isKnown(other.type);
  return literalAgainstKnown(left, ones, right) || literalAgainstKnown(right, others, left)
    ? false
    : undefined;
}

/** Whether `type` is known where it is checked: not per instantiation, nor `Never` or an error. */
export function isKnown(type: Type): boolean {
  return !isOpaque(type) && type.kind !== 'error' && !isPrimitive(type, 'Never');
}

/** The literals `side` may be: its own, written as a literal, else its type's. */
function sideLiterals(side: ComparedSide, memberUnionOf: MemberUnionOf): KnownLiterals | undefined {
  const written = side.node === undefined ? undefined : writtenLiteral(side.node);
  return written === undefined
    ? literalsOf(side.type, memberUnionOf)
    : { values: [written.value], anyNameBut: undefined };
}

/** The literals a value of `type` may be (the module's banner); undefined when not known. */
function literalsOf(type: Type, memberUnionOf: MemberUnionOf): KnownLiterals | undefined {
  if (isPrimitive(type, 'Never')) {
    return undefined;
  }
  const ranging = isMemberParameter(type) ? memberUnionOf(type) : type;
  const values: LiteralValue[] = [];
  let anyNameBut: string[] | undefined;
  for (const member of membersOf(ranging ?? type)) {
    if (member.kind === 'literal') {
      values.push(member.value);
    } else if (member.kind === 'keys') {
      anyNameBut = [...(anyNameBut ?? member.without)].filter((name) =>
        member.without.includes(name),
      );
    } else {
      return undefined;
    }
  }
  return { values, anyNameBut };
}

/** Whether values of two known literal sets are always, or never, equal; else undefined. */
function decidedEqual(
  left: KnownLiterals | undefined,
  right: KnownLiterals | undefined,
): boolean | undefined {
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const [one, other] = [singleLiteral(left), singleLiteral(right)];
  if (one !== undefined && other !== undefined) {
    return one === other;
  }
  if (one !== undefined && !mayBe(right, one)) {
    return false;
  }
  return other !== undefined && !mayBe(left, other) ? false : undefined;
}

/** The one literal `known` holds; undefined for any other set. */
function singleLiteral(known: KnownLiterals | undefined): LiteralValue | undefined {
  return known?.anyNameBut === undefined && known?.values.length === 1
    ? known.values[0]
    : undefined;
}

/** Whether a value of `known` may be `value`. */
function mayBe(known: KnownLiterals, value: LiteralValue): boolean {
  return (
    known.values.includes(value) ||
    (typeof value === 'string' &&
      known.anyNameBut !== undefined &&
      !known.anyNameBut.includes(value))
  );
}
