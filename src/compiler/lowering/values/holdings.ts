/**
 * Where a value of one type sits in a value of another (§2, §3.5), as an instantiation made both:
 * the one derivation every way in and out of a union or `any` type reads (unions.ts,
 * ../parts/patterns.ts, optionals.ts, ../trait-objects/), so a layout an instantiation changed is
 * never patched afterwards.
 *
 * - A union's value is the variant of its enum holding a member (tables/type-table.ts): the member's own,
 *   its literal's base, whose value a literal is, or the `any` member that took it whole.
 * - An `any` type's value is the variant of its enum holding a concrete type's value, its base's
 *   for a literal. Where an instantiation let an `any` type take a member whole (`T | any
 *   Stringable` with `T = Int`), a value of the member sits there, in the union's variant of that
 *   `any` member or in the `any` type the union collapsed into, and a test of it is the union's
 *   test, then the `any` type's.
 * - A recursive type is laid out as what it unfolds to (§3.17), one type, and a recursive union in
 *   a union is flattened into it, so a union holds each member directly.
 * - A member with one value, a literal or `none`, holds nothing in its own variant.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { unfoldRecursive } from '../../checker/types/computed-types.ts';
import { sameType } from '../../checker/types/identity/identity.ts';
import type { AnyType, Type, UnionType } from '../../checker/types/type/index.ts';
import { absorbingMember, baseOf } from '../../checker/types/unions/union-members.ts';
import { hasMember, hasOneValue } from '../../checker/types/unions/unions.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { Label } from '../code-writer.ts';
import type { CodeContext } from '../context.ts';

/** A value in a register, with its type. */
export interface TypedValue {
  readonly register: Register;
  readonly type: Type;
}

/**
 * Where a value of a type sits in a value of `holder`, both as an instantiation made them (§2,
 * §3.5): in the variant of `holder`'s member `variant`, its own, its literal's base, or the `any`
 * member that took it whole, none when `holder` is no union; and inside `inAny`, where an `any`
 * type took it whole, `holder` itself or its member.
 */
export interface Holding {
  readonly variant?: Type | undefined;
  readonly inAny?: AnyType | undefined;
}

/** `type` as its values are laid out: what a recursive type unfolds to (the banner). */
export function laidOutAs(type: Type): Type {
  return type.kind === 'recursive' ? unfoldRecursive(type) : type;
}

/** Where `holder` holds a value of `member` (`Holding`); undefined when it holds none. */
export function holdingOf(context: CodeContext, given: Type, member: Type): Holding | undefined {
  const rules = context.checker.typeRules;
  const holder = laidOutAs(given);
  if (holder.kind !== 'union') {
    if (sameType(holder, member) || sameType(holder, baseOf(member))) {
      return {};
    }
    return holder.kind === 'any' && absorbingMember([holder], member, rules) !== undefined
      ? { inAny: holder }
      : undefined;
  }
  if (hasMember(holder, member)) {
    return { variant: member };
  }
  if (member.kind === 'literal' && hasMember(holder, baseOf(member))) {
    return { variant: baseOf(member) };
  }
  const absorbing = absorbingMember(holder.members, member, rules);
  return absorbing === undefined ? undefined : { variant: absorbing, inAny: absorbing };
}

/** The fields read from a value of `holder` down to the value it holds where `holding` says. */
export function heldPositions(holder: Type, holding: Holding): readonly number[] {
  const inVariant = laidOutAs(holder).kind === 'union' && holding.variant !== undefined;
  return [...(inVariant ? [0] : []), ...(holding.inAny === undefined ? [] : [0])];
}

/** A value of a type, which `inside` gives once asked, with its type. */
export interface HeldValue {
  readonly member: Type;
  readonly inside: () => Register;
}

/**
 * The value `held` gives as the value of `holder` holding it; a member with one value holds
 * nothing in its own variant, so `inside` is asked only where the value goes inside.
 */
export function heldIn(
  context: CodeContext,
  { member, inside }: HeldValue,
  given: Type,
  span: AnchoredSpan,
): Register {
  const holder = laidOutAs(given);
  const { variant, inAny } =
    holdingOf(context, holder, member) ?? unreachable('A value goes only where it is held.');
  if (
    holder.kind === 'union' &&
    variant !== undefined &&
    inAny === undefined &&
    hasOneValue(variant)
  ) {
    return memberValue(context, { union: holder, member: variant, fields: [] }, span);
  }
  const value =
    inAny === undefined
      ? inside()
      : heldInAny(context, { value: inside(), from: member, to: inAny }, span);
  return holder.kind === 'union' && variant !== undefined
    ? memberValue(context, { union: holder, member: variant, fields: [value] }, span)
    : value;
}

/** A value converted into an `any` type: the register holding it, its concrete type, the target. */
export interface IntoAny {
  readonly value: Register;
  readonly from: Type;
  readonly to: AnyType;
}

/**
 * `value`, of a type neither `any` nor a union, as the variant of the `any` type holding it: its
 * base's for a literal, whose value it is (§2), so a downcast to the base finds it.
 */
export function heldInAny(context: CodeContext, { value, from, to }: IntoAny, span: AnchoredSpan) {
  const { tables, code } = context;
  const dst = code.allocate();
  const type = tables.types.anyIndex(to);
  const variant = tables.types.anyVariant(to, baseOf(from));
  code.emit({ kind: 'variant', span, dst, type, variant, fields: [value] });
  return dst;
}

/** The variant of `union`'s enum holding `member`. */
function variantOf(context: CodeContext, union: UnionType, member: Type): number {
  return context.tables.types.unionVariant(union, member);
}

/** Where a branch goes: to `matched` when its test passes, else to `otherwise`. */
interface Branch {
  readonly matched: Label;
  readonly otherwise: Label;
}

/**
 * Jumps to `matched` when `value` holds a value of one of `members` (`holdingOf`), else to
 * `otherwise`: a `switch` on its union's variants, and on the variants of an `any` type that took
 * one whole. A literal member held as its base takes a comparison, which is the caller's.
 */
export function branchOnHeld(
  context: CodeContext,
  { value, members }: { readonly value: TypedValue; readonly members: readonly Type[] },
  { matched, otherwise }: Branch,
  span: AnchoredSpan,
): void {
  const { code } = context;
  const type = laidOutAs(value.type);
  const held = members.flatMap((member) => {
    const holding = holdingOf(context, type, member);
    return holding === undefined ? [] : [{ member, holding }];
  });
  if (type.kind !== 'union') {
    const absorbed = held.filter(({ holding }) => holding.inAny !== undefined);
    if (absorbed.length < held.length || type.kind !== 'any') {
      code.jump(held.length > 0 ? matched : otherwise, span);
      return;
    }
    const any = { register: value.register, type };
    branchOnAnyVariants(
      context,
      { value: any, members: absorbed.map(({ member }) => member) },
      { matched, otherwise },
      span,
    );
    return;
  }
  const pending: { label: Label; inside: AnyType; members: Type[] }[] = [];
  const targets = context.tables.types.unionMembers(type).map((variant) => {
    const here = held.filter(({ holding }) => sameType(holding.variant ?? variant, variant));
    if (here.some(({ holding }) => holding.inAny === undefined)) {
      return matched;
    }
    if (here.length === 0 || variant.kind !== 'any') {
      return otherwise;
    }
    const label = code.newLabel();
    pending.push({ label, inside: variant, members: here.map(({ member }) => member) });
    return label;
  });
  code.switch(value.register, targets, span, otherwise);
  for (const { label, inside, members: absorbed } of pending) {
    code.place(label);
    const any = { register: code.field(value.register, 0, span), type: inside };
    branchOnAnyVariants(context, { value: any, members: absorbed }, { matched, otherwise }, span);
  }
}

/** Jumps to `matched` when the `any` value `value` holds one of `members`, else to `otherwise`. */
function branchOnAnyVariants(
  context: CodeContext,
  {
    value,
    members,
  }: {
    readonly value: { readonly register: Register; readonly type: AnyType };
    readonly members: readonly Type[];
  },
  { matched, otherwise }: Branch,
  span: AnchoredSpan,
): void {
  const variants = new Set(
    members.map((member) => context.tables.types.anyVariant(value.type, baseOf(member))),
  );
  const targets = Array.from({ length: Math.max(...variants) + 1 }, (_, index) =>
    variants.has(index) ? matched : otherwise,
  );
  context.code.switch(value.register, targets, span, otherwise);
}

/** Jumps to `to` when `value` holds a value of `member`, else carries on. */
export function jumpIfHeld(
  context: CodeContext,
  { value, member }: { readonly value: TypedValue; readonly member: Type },
  to: Label,
  span: AnchoredSpan,
): void {
  const past = context.code.newLabel();
  branchOnHeld(context, { value, members: [member] }, { matched: to, otherwise: past }, span);
  context.code.place(past);
}

/** A value of `union` built as its `member`'s variant, holding `fields`. */
interface MemberBuilt {
  readonly union: UnionType;
  readonly member: Type;
  readonly fields: readonly Register[];
}

/** A value of `union` as its `member`'s variant, holding `fields`. */
export function memberValue(
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
