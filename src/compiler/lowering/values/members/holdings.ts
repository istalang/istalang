/**
 * Where a value of one type sits in a value of another (§2, §3.5), as an instantiation made both,
 * and reading or building it there: every way in and out of a union or `any` type (index.ts,
 * tests.ts) derives it here, so a layout an instantiation changed is never patched afterwards.
 *
 * - A union's value is the variant of its enum holding a member (tables/type-table.ts): the
 *   member's own, its literal's base, whose value a literal is, or the `any` member that took it
 *   whole.
 * - An `any` type's value is the variant of its enum holding a concrete type's value, its base's
 *   for a literal: any type the checker let convert into it (§3.10), through variance too. Only a
 *   union's layout asks which `any` member took a member whole (§2: `T | any Stringable` with
 *   `T = Int`), its value sitting in the union's variant of that `any` member.
 * - A member's variant holds its value as its one field; a member with one value, a literal or
 *   `none`, holds nothing there.
 * - A recursive type is laid out as what it unfolds to (§3.17), one type, and a recursive union in
 *   a union is flattened into it, so a union holds each member directly.
 */

import type { PlaceStep } from '../../../../definition/instructions/places.ts';
import type { Register } from '../../../../definition/operands.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { sameType } from '../../../checker/types/identity/identity.ts';
import { unfoldRecursive } from '../../../checker/types/type/computed-types.ts';
import type { AnyType, Type, UnionType } from '../../../checker/types/type/index.ts';
import { absorbingMember, baseOf } from '../../../checker/types/unions/union-members.ts';
import { hasMember, hasOneValue } from '../../../checker/types/unions/unions.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { CodeContext, TypedValue } from '../../context.ts';
import type { HeldVariant } from '../../tables/type-table.ts';
import { variantAt } from '../variant-values.ts';

/**
 * Where a value sits in a value of a holder, both as an instantiation made them (§2, §3.5): the
 * holder itself, of the value's type or its literal's base; inside the `any` holder it converted
 * into; in the variant of the holder `union`'s member `variant`, its own or its literal's base; or
 * inside the `any` member `variant` of `union` that took it whole.
 */
export type Holding =
  | { readonly kind: 'itself' }
  | { readonly kind: 'inAny'; readonly any: AnyType }
  | { readonly kind: 'variant'; readonly union: UnionType; readonly variant: Type }
  | { readonly kind: 'variantInAny'; readonly union: UnionType; readonly variant: AnyType };

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
      return { kind: 'itself' };
    }
    return holder.kind === 'any' && member.kind !== 'any' && member.kind !== 'union'
      ? { kind: 'inAny', any: holder }
      : undefined;
  }
  if (hasMember(holder, member)) {
    return { kind: 'variant', union: holder, variant: member };
  }
  if (member.kind === 'literal' && hasMember(holder, baseOf(member))) {
    return { kind: 'variant', union: holder, variant: baseOf(member) };
  }
  const absorbing = absorbingMember(holder.members, member, rules);
  return absorbing === undefined
    ? undefined
    : { kind: 'variantInAny', union: holder, variant: absorbing };
}

/** Borrows the value of `held` the `variant`-th variant of the union or `any` value holds. */
export function heldAt(
  context: CodeContext,
  holder: Register,
  { variant, held }: HeldVariant,
  span: AnchoredSpan,
): Register {
  const reference = context.tables.types.reference(held);
  return context.code.variantField(holder, { variant, field: 0 }, reference, span);
}

/** The step of a place into the value the `variant`-th variant of a union or `any` value holds. */
export function heldStep(variant: number): PlaceStep {
  return { kind: 'variant', variant, field: 0 };
}

/**
 * Borrows the value of `member` that `value` holds where `holdingOf` says, which a test made sure
 * it does: out of its union's variant, then out of the `any` type's variant holding it.
 */
export function readHeld(
  context: CodeContext,
  value: TypedValue,
  member: Type,
  span: AnchoredSpan,
): Register {
  const { tables } = context;
  const holding = holdingOf(context, value.type, member);
  const inUnion = (union: UnionType, variant: Type) =>
    heldAt(
      context,
      value.register,
      { variant: tables.types.unionVariant(union, variant), held: variant },
      span,
    );
  const inAny = (register: Register, any: AnyType) =>
    heldAt(context, register, tables.types.anyVariant(any, member), span);
  switch (holding?.kind) {
    case undefined:
    case 'itself':
      return value.register;
    case 'inAny':
      return inAny(value.register, holding.any);
    case 'variant':
      return inUnion(holding.union, holding.variant);
    case 'variantInAny':
      return inAny(inUnion(holding.union, holding.variant), holding.variant);
    default: {
      const unhandled: never = holding;
      return unhandled;
    }
  }
}

/** A value of a type, which `inside` gives once asked, with its type. */
interface HeldValue {
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
  const holding =
    holdingOf(context, given, member) ?? unreachable('A value goes only where it is held.');
  switch (holding.kind) {
    case 'itself':
      return inside();
    case 'inAny':
      return heldInAny(context, { value: inside(), from: member, to: holding.any }, span);
    case 'variant': {
      const fields = hasOneValue(holding.variant) ? [] : [inside()];
      return memberValue(context, { union: holding.union, member: holding.variant, fields }, span);
    }
    case 'variantInAny': {
      const into = { value: inside(), from: member, to: holding.variant };
      const fields = [heldInAny(context, into, span)];
      return memberValue(context, { union: holding.union, member: holding.variant, fields }, span);
    }
    default: {
      const unhandled: never = holding;
      return unhandled;
    }
  }
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
  const { variant } = context.tables.types.anyVariant(to, from);
  return variantAt(context, { type: to, variant, fields: [value] }, span);
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
  const variant = context.tables.types.unionVariant(union, member);
  return variantAt(context, { type: union, variant, fields }, span);
}
