/**
 * Union values in lowered code (§2): the one place that knows how a value of `A | B` is laid out,
 * an enum with a variant per member (tables/type-table.ts), which conversions, `none`, the optional
 * operators and patterns all go through.
 *
 * - Into a union, a value of a member becomes that member's variant; a union becomes the wider
 *   one variant by variant, a literal member going into its base where the base is the member.
 * - Out of a union, where a test has made sure which members it can be: the one member's value, or
 *   the union of those members, variant by variant. A member with one value, a literal or `none`,
 *   holds nothing, so its value is that one value, written as a constant.
 * - An instantiation may merge literals into their base (§3.5): `T | "a" | "b"` with `T = String`
 *   is `String`, or a union holding `String`. A value of the base taken as a union of those
 *   literals is compared with each, a test having made sure it is one.
 * - A literal type on its own is its base's value, so taking it as its base changes nothing; a
 *   union of literals is a tag, whose literal is written variant by variant.
 * - An instantiation may let an `any` member take a member whole (§2, §3.5): `T | any Stringable`
 *   with `T = Int` is `any Stringable`. A value of the member then sits inside the `any` type's
 *   variant, which goes into the union's variant of that `any` member, and a test of it is the
 *   union's test, then the `any` type's. Where a type sits in another (`holdingOf`) is derived
 *   here, from the types as the instantiation made them, for every way in or out.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import { distinctItems } from '../../../foundation/structures/equality.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { sameType } from '../../checker/types/identity/identity.ts';
import type { AnyType, LiteralType, Type, UnionType } from '../../checker/types/type/index.ts';
import { isPrimitive } from '../../checker/types/type/primitives.ts';
import { baseOf } from '../../checker/types/unions/union-members.ts';
import { hasOneValue } from '../../checker/types/unions/unions.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';
import { emitConstant } from '../tables/constants.ts';
import {
  branchOnHeld,
  heldIn,
  holdingOf,
  laidOutAs,
  memberValue,
  readHeld,
  type TypedValue,
} from './holdings.ts';

/** A value of a union in a register. */
interface UnionValue {
  readonly register: Register;
  readonly type: UnionType;
}

/** The value of `holder` that is the one value of `member`, a literal or `None`. */
export function oneValueIn(
  context: CodeContext,
  holder: Type,
  member: Type,
  span: AnchoredSpan,
): Register {
  const inside = () => emitConstant(context, oneValueOf(member), member, span);
  return heldIn(context, { member, inside }, holder, span);
}

/**
 * `value`, of a type `union` holds (`holdingOf`), or a union whose every member it holds, as a
 * value of `union`, or of the `any` type an instantiation collapsed it into. A literal's own value
 * is its base's, so it goes into the base's variant.
 */
export function intoUnion(
  context: CodeContext,
  value: TypedValue,
  union: UnionType | AnyType,
  span: AnchoredSpan,
): Register {
  const { register } = value;
  const type = laidOutAs(value.type);
  if (sameType(type, union)) {
    return register;
  }
  if (type.kind !== 'union') {
    return heldIn(context, { member: type, inside: () => register }, union, span);
  }
  return union.kind === 'union'
    ? remapped(context, { register, type }, union, span)
    : eachMember(context, { register, type }, { result: union, span }, (member) =>
        intoUnion(context, member, union, span),
      );
}

/**
 * `value`, of the union `value.type`, as `to`: one of its members, a union of some of them, or the
 * union itself. A test made sure the value is one of `to`'s members. Where an instantiation
 * collapsed the union into one type, `to` is that type or literals merged into it, and where an
 * `any` type took `to`, or each of its members, whole, its value is read out of the `any` type's.
 */
export function outOfUnion(
  context: CodeContext,
  value: TypedValue,
  given: Type,
  span: AnchoredSpan,
): Register {
  const { register } = value;
  const type = laidOutAs(value.type);
  const to = laidOutAs(given);
  if (sameType(to, type)) {
    return register;
  }
  if (to.kind === 'union') {
    if (type.kind === 'any') {
      return outOfAny(context, { register, type }, to, span);
    }
    return type.kind === 'union'
      ? remapped(context, { register, type }, to, span)
      : literalIn(context, value, to, span);
  }
  if (hasOneValue(to)) {
    return emitConstant(context, oneValueOf(to), to, span);
  }
  return readHeld(context, { register, type }, to, span);
}

/**
 * `value`, of an `any` type that took each member of `to` whole (§2, §3.5), as a value of `to`,
 * which a test made sure it is: the `any` type's value tested for each type it may hold, a
 * literal's base standing for its literals, but the last, which is what is left.
 */
function outOfAny(
  context: CodeContext,
  value: { readonly register: Register; readonly type: AnyType },
  to: UnionType,
  span: AnchoredSpan,
): Register {
  const { code } = context;
  const result = code.allocate(context.tables.types.reference(to));
  const end = code.newLabel();
  const carriers = distinctItems(
    to.members.map((member) => (member.kind === 'literal' ? baseOf(member) : member)),
    sameType,
  );
  for (const [index, carrier] of carriers.entries()) {
    const next = code.newLabel();
    if (index < carriers.length - 1) {
      const here = code.newLabel();
      branchOnHeld(
        context,
        { value, members: [carrier] },
        { matched: here, otherwise: next },
        span,
      );
      code.place(here);
    }
    const inside = () => outOfUnion(context, value, carrier, span);
    const built = to.members.some((member) => sameType(member, carrier))
      ? heldIn(context, { member: carrier, inside }, to, span)
      : literalIn(context, { register: inside(), type: carrier }, to, span);
    code.emit({ kind: 'move', span, dst: result, src: code.take(built, span) });
    code.jump(end, span);
    code.place(next);
  }
  code.place(end);
  return result;
}

/**
 * A value of a literal type, or of a union of literals, as their base (§2): itself for a literal,
 * since it is its base's value already, and the tag's literal for a union.
 */
export function asBase(context: CodeContext, value: TypedValue, span: AnchoredSpan): Register {
  const type = laidOutAs(value.type);
  if (type.kind !== 'union') {
    return value.register;
  }
  const base = baseOf(type.members[0] ?? unreachable('A union has members.'));
  return eachVariant(context, { register: value.register, type }, span, {
    result: base,
    each: (member) => emitConstant(context, oneValueOf(member), member, span),
  });
}

/** The one value of `member`, which has one: a literal's, or `none`, which is `null`. */
function oneValueOf(member: Type): Value {
  if (member.kind === 'literal') {
    return literalValue(member);
  }
  return isPrimitive(member, 'None') ? null : unreachable('Only a literal or None has one value.');
}

/** The value a literal type's one value is at run time: its base's (§2). */
export function literalValue(type: LiteralType): Value {
  return type.value;
}

/**
 * `value` as a value of `to`, variant by variant: each member of `value.type` goes into the member
 * of `to` it is, its literal into its base, or a base into the literal of it `to` holds that it
 * equals. A member `to` takes none of is one a test ruled out, so its variant never runs
 * (`eachVariant`).
 */
function remapped(
  context: CodeContext,
  value: UnionValue,
  to: UnionType,
  span: AnchoredSpan,
): Register {
  const holds = (member: Type) => holdingOf(context, to, member) !== undefined;
  return eachVariant(context, value, span, {
    result: to,
    each: (member) => {
      const inside = () =>
        hasOneValue(member)
          ? emitConstant(context, oneValueOf(member), member, span)
          : context.code.variantField(
              value.register,
              { variant: context.tables.types.unionVariant(value.type, member), field: 0 },
              context.tables.types.reference(member),
              span,
            );
      return holds(member)
        ? heldIn(context, { member, inside }, to, span)
        : literalIn(context, { register: inside(), type: member }, to, span);
    },
    runs: (member) => holds(member) || literalsOf(to, member).length > 0,
  });
}

/** The literal members of `union` whose base is `base`. */
function literalsOf(union: UnionType, base: Type): readonly LiteralType[] {
  return union.members.filter(
    (member): member is LiteralType => member.kind === 'literal' && sameType(baseOf(member), base),
  );
}

/**
 * `value`, of a base, as the literal member of `to` it equals, which a test made sure it is: each
 * but the last is compared with it, and the last is what is left.
 */
function literalIn(
  context: CodeContext,
  value: TypedValue,
  to: UnionType,
  span: AnchoredSpan,
): Register {
  const { code } = context;
  const result = code.allocate(context.tables.types.reference(to));
  const end = code.newLabel();
  const literals = literalsOf(to, value.type);
  if (literals.length === 0) {
    unreachable('A value is taken only as literals of its own base.');
  }
  for (const [index, literal] of literals.entries()) {
    const next = code.newLabel();
    if (index < literals.length - 1) {
      const equals = code.newLabel();
      const constant = emitConstant(context, literalValue(literal), literal, span);
      code.branch(code.equal(value.register, constant, span), equals, next, span);
      code.place(equals);
    }
    const built = memberValue(context, { union: to, member: literal, fields: [] }, span);
    code.emit({ kind: 'move', span, dst: result, src: code.take(built, span) });
    code.jump(end, span);
    code.place(next);
  }
  code.place(end);
  return result;
}

/**
 * Switches on `value`'s variant, each member's case giving what `each` writes for the member's
 * value, into one register.
 */
export function eachMember(
  context: CodeContext,
  value: UnionValue,
  { result, span }: { readonly result: Type; readonly span: AnchoredSpan },
  each: (member: TypedValue) => Register,
): Register {
  return eachVariant(context, value, span, {
    result,
    each: (member) => each({ register: outOfUnion(context, value, member, span), type: member }),
  });
}

/** What each member's case of a switch runs, and which members it never reaches. */
interface MemberCases {
  readonly each: (member: Type) => void;
  readonly runs?: ((member: Type) => boolean) | undefined;
}

/** What each member's case of a switch writes, and which members it never reaches. */
interface VariantCases {
  readonly result: Type;
  readonly each: (member: Type) => Register;
  readonly runs?: (member: Type) => boolean;
}

/**
 * Switches on `value`'s variant, each member's case giving what `each` writes for it, into one
 * register. A member `runs` rules out never runs: its variant goes where the first one kept does.
 */
function eachVariant(
  context: CodeContext,
  value: UnionValue,
  span: AnchoredSpan,
  { result: type, each, runs = () => true }: VariantCases,
): Register {
  const { code } = context;
  const result = code.allocate(context.tables.types.reference(type));
  onEachMember(context, value, span, {
    each: (member) =>
      code.emit({ kind: 'move', span, dst: result, src: code.take(each(member), span) }),
    runs,
  });
  return result;
}

/**
 * Switches on `value`'s variant, each member's case running what `each` writes for it, then going
 * on past the switch. A member `runs` rules out never runs, as `eachVariant` says.
 */
export function onEachMember(
  context: CodeContext,
  value: UnionValue,
  span: AnchoredSpan,
  { each, runs = () => true }: MemberCases,
): void {
  const { code } = context;
  const members = context.tables.types.unionMembers(value.type);
  const kept = members.map((member) => (runs(member) ? code.newLabel() : undefined));
  const first = kept.find((label) => label !== undefined) ?? unreachable('A member is kept.');
  const end = code.newLabel();
  code.switch(
    value.register,
    kept.map((label) => label ?? first),
    span,
  );
  members.forEach((member, index) => {
    const label = kept[index];
    if (label === undefined) {
      return;
    }
    code.place(label);
    each(member);
    code.jump(end, span);
  });
  code.place(end);
}
