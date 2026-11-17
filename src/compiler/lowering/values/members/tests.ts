/**
 * Testing which member a union or `any` value holds (§2, §3.5), where holdings.ts says each sits:
 * a `switch` on the union's variants, then on the variants of an `any` type that took a member
 * whole. An instantiation may have collapsed the union into one type, which a member of that type
 * passes and no other, or merged a literal member into its base, whose value is then compared
 * with the literal.
 */

import { sameType } from '../../../checker/types/identity/identity.ts';
import type { AnyType, LiteralType, Type } from '../../../checker/types/type/index.ts';
import { baseOf } from '../../../checker/types/unions/union-members.ts';
import { hasMember } from '../../../checker/types/unions/unions.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { CodeContext, TypedValue } from '../../context.ts';
import type { Label } from '../../functions/code-writer.ts';
import { emitConstant } from '../../tables/constants.ts';
import { equal } from '../operators.ts';
import { heldAt, holdingOf, laidOutAs, readHeld } from './holdings.ts';

/** Where a test goes: to `matched` when it passes, else to `otherwise`. */
export interface Branch {
  readonly matched: Label;
  readonly otherwise: Label;
}

/** What a member test tests: a value, and the members it passes for. */
interface MembersTest {
  readonly value: TypedValue;
  readonly members: readonly Type[];
}

/**
 * Jumps to `matched` when `value` holds one of `members`, else to `otherwise`, a literal merged
 * into its base passing where the base's value equals it (the banner).
 */
export function branchOnMembers(
  context: CodeContext,
  { value, members }: MembersTest,
  { matched, otherwise }: Branch,
  span: AnchoredSpan,
): void {
  const { code } = context;
  const holder = laidOutAs(value.type);
  const tested = { register: value.register, type: holder };
  const isOwn = (member: Type) =>
    holder.kind === 'union' ? hasMember(holder, member) : sameType(holder, member);
  const merged = members.filter(
    (member): member is LiteralType => member.kind === 'literal' && !isOwn(member),
  );
  const held = members.filter((member) => !merged.includes(member as LiteralType));
  let next = merged.length === 0 ? otherwise : code.newLabel();
  branchOnHeld(context, { value: tested, members: held }, { matched, otherwise: next }, span);
  for (const [index, literal] of merged.entries()) {
    code.place(next);
    next = index === merged.length - 1 ? otherwise : code.newLabel();
    const holdsBase = code.newLabel();
    const base = baseOf(literal);
    branchOnHeld(
      context,
      { value: tested, members: [base] },
      { matched: holdsBase, otherwise: next },
      span,
    );
    code.place(holdsBase);
    const inside = readHeld(context, tested, base, span);
    const constant = emitConstant(context, literal.value, literal, span);
    code.branch(equal(context, span, [inside, constant]), matched, next, span);
  }
}

/**
 * Jumps to `matched` when `value` holds a value of one of `members` (`holdingOf`), else to
 * `otherwise`. A literal member held as its base takes a comparison, `branchOnMembers`'.
 */
export function branchOnHeld(
  context: CodeContext,
  { value, members }: MembersTest,
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
    const absorbed = held.filter(({ holding }) => holding.kind === 'inAny');
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
  const pending: { label: Label; variant: number; inside: AnyType; members: Type[] }[] = [];
  const targets = context.tables.types.unionMembers(type).map((variant, position) => {
    const here = held.filter(
      ({ holding }) =>
        (holding.kind === 'variant' || holding.kind === 'variantInAny') &&
        sameType(holding.variant, variant),
    );
    if (here.some(({ holding }) => holding.kind === 'variant')) {
      return matched;
    }
    if (here.length === 0 || variant.kind !== 'any') {
      return otherwise;
    }
    const label = code.newLabel();
    pending.push({
      label,
      variant: position,
      inside: variant,
      members: here.map(({ member }) => member),
    });
    return label;
  });
  code.switch(value.register, targets, span, otherwise);
  for (const { label, variant, inside, members: absorbed } of pending) {
    code.place(label);
    const inner = heldAt(context, value.register, { variant, member: inside }, span);
    const any = { register: inner, type: inside };
    branchOnAnyVariants(context, { value: any, members: absorbed }, { matched, otherwise }, span);
  }
}

/** Jumps to `matched` when the `any` value `value` holds one of `members`, else to `otherwise`. */
function branchOnAnyVariants(
  context: CodeContext,
  { value, members }: { readonly value: TypedValue<AnyType>; readonly members: readonly Type[] },
  { matched, otherwise }: Branch,
  span: AnchoredSpan,
): void {
  const variants = new Set(
    members.map((member) => context.tables.types.anyVariant(value.type, member)),
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
