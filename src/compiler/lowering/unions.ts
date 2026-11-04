/**
 * Union values in lowered code (§2): the one place that knows how a value of `A | B` is laid out,
 * an enum with a variant per member (type-table.ts), which conversions, `none`, the optional
 * operators and patterns all go through.
 *
 * - Into a union, a value of a member becomes that member's variant; a union becomes the wider
 *   one variant by variant, a literal member going into its base where the base is the member.
 * - Out of a union, where a test has made sure which members it can be: the one member's value, or
 *   the union of those members, variant by variant. A member with one value, a literal or `none`,
 *   holds nothing, so its value is that one value, written as a constant.
 * - A literal type on its own is its base's value, so taking it as its base changes nothing; a
 *   union of literals is a tag, whose literal is written variant by variant.
 */

import type { Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { sameType } from '../checker/types/identity.ts';
import { isPrimitive, type LiteralType, type Type, type UnionType } from '../checker/types/type.ts';
import { baseOf, hasMember, hasOneValue } from '../checker/types/unions.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { Label } from './code-writer.ts';
import { emitConstant } from './constants.ts';
import type { CodeContext } from './context.ts';

/** A value in a register, with its type. */
export interface TypedValue {
  readonly register: Register;
  readonly type: Type;
}

/** A value of a union in a register. */
export interface UnionValue {
  readonly register: Register;
  readonly type: UnionType;
}

/** The value of `union` that is the one value of `member`, a literal or `None`. */
export function oneValueIn(
  context: CodeContext,
  union: UnionType,
  member: Type,
  span: AnchoredSpan,
): Register {
  return memberValue(context, { union, member, fields: [] }, span);
}

/**
 * `value`, of a member of `union`, a literal of a member's base, or a union `union` holds whole,
 * as a value of `union`. A literal's own value is its base's, so it goes into the base's variant.
 */
export function intoUnion(
  context: CodeContext,
  value: TypedValue,
  union: UnionType,
  span: AnchoredSpan,
): Register {
  const { type } = value;
  if (type.kind === 'union') {
    return remapped(context, { register: value.register, type }, union, span);
  }
  const member = type.kind === 'literal' && !hasMember(union, type) ? baseOf(type) : type;
  return memberValue(
    context,
    { union, member, fields: hasOneValue(member) ? [] : [value.register] },
    span,
  );
}

/**
 * `value`, of the union `value.type`, as `to`: one of its members, a union of some of them, or the
 * union itself. A test made sure the value is one of `to`'s members.
 */
export function outOfUnion(
  context: CodeContext,
  value: UnionValue,
  to: Type,
  span: AnchoredSpan,
): Register {
  if (sameType(to, value.type)) {
    return value.register;
  }
  if (to.kind === 'union') {
    return remapped(context, value, to, span);
  }
  return hasOneValue(to)
    ? emitConstant(context, oneValueOf(to), span)
    : context.code.field(value.register, 0, span);
}

/**
 * A value of a literal type, or of a union of literals, as their base (§2): itself for a literal,
 * since it is its base's value already, and the tag's literal for a union.
 */
export function asBase(context: CodeContext, value: TypedValue, span: AnchoredSpan): Register {
  const { type } = value;
  if (type.kind !== 'union') {
    return value.register;
  }
  return eachVariant(context, { register: value.register, type }, span, {
    each: (member) => emitConstant(context, oneValueOf(member), span),
  });
}

/** The variant of `union`'s enum holding `member`. */
function variantOf(context: CodeContext, union: UnionType, member: Type): number {
  return context.tables.types.unionVariant(union, member);
}

/** Jumps to `matched` when `value` holds one of `members`, else to `otherwise`: a `switch`. */
export function branchOnMembers(
  context: CodeContext,
  { value, members }: { readonly value: UnionValue; readonly members: readonly Type[] },
  labels: { readonly matched: Label; readonly otherwise: Label },
  span: AnchoredSpan,
): void {
  const variants = context.tables.types.unionMembers(value.type);
  const targets = variants.map((variant) =>
    members.some((member) => sameType(member, variant)) ? labels.matched : labels.otherwise,
  );
  context.code.switch(value.register, targets, span, labels.otherwise);
}

/** Jumps to `to` when `value` holds `member`, else carries on. */
export function jumpIfMember(
  context: CodeContext,
  { value, member }: { readonly value: UnionValue; readonly member: Type },
  to: Label,
  span: AnchoredSpan,
): void {
  const past = context.code.newLabel();
  branchOnMembers(context, { value, members: [member] }, { matched: to, otherwise: past }, span);
  context.code.place(past);
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

/** A value of `union` built as its `member`'s variant, holding `fields`. */
interface MemberBuilt {
  readonly union: UnionType;
  readonly member: Type;
  readonly fields: readonly Register[];
}

/** A value of `union` as its `member`'s variant, holding `fields`. */
function memberValue(
  context: CodeContext,
  { union, member, fields }: MemberBuilt,
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'variant',
    span,
    dst,
    type: context.tables.types.index(union),
    variant: variantOf(context, union, member),
    fields: [...fields],
  });
  return dst;
}

/**
 * `value` as a value of `to`, variant by variant: each member of `value.type` goes into the member
 * of `to` it is, or its literal into its base. A member `to` lacks is one a test ruled out, so its
 * variant never runs (`eachVariant`).
 */
function remapped(
  context: CodeContext,
  value: UnionValue,
  to: UnionType,
  span: AnchoredSpan,
): Register {
  const targetOf = (member: Type): Type | undefined => {
    if (hasMember(to, member)) {
      return member;
    }
    return member.kind === 'literal' && hasMember(to, baseOf(member)) ? baseOf(member) : undefined;
  };
  return eachVariant(context, value, span, {
    each: (member) => {
      const target = targetOf(member) ?? unreachable('Only a member kept is written.');
      if (hasOneValue(target)) {
        return memberValue(context, { union: to, member: target, fields: [] }, span);
      }
      const inside = hasOneValue(member)
        ? emitConstant(context, oneValueOf(member), span)
        : context.code.field(value.register, 0, span);
      return memberValue(context, { union: to, member: target, fields: [inside] }, span);
    },
    runs: (member) => targetOf(member) !== undefined,
  });
}

/**
 * Switches on `value`'s variant, each member's case giving what `each` writes for the member's
 * value, into one register.
 */
export function eachMember(
  context: CodeContext,
  value: UnionValue,
  span: AnchoredSpan,
  each: (member: TypedValue) => Register,
): Register {
  return eachVariant(context, value, span, {
    each: (member) => each({ register: outOfUnion(context, value, member, span), type: member }),
  });
}

/** What each member's case of a switch writes, and which members it never reaches. */
interface VariantCases {
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
  { each, runs = () => true }: VariantCases,
): Register {
  const { code } = context;
  const members = context.tables.types.unionMembers(value.type);
  const kept = members.map((member) => (runs(member) ? code.newLabel() : undefined));
  const first = kept.find((label) => label !== undefined) ?? unreachable('A member is kept.');
  const result = code.allocate();
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
    code.emit({ kind: 'move', span, dst: result, src: each(member) });
    code.jump(end, span);
  });
  code.place(end);
  return result;
}
