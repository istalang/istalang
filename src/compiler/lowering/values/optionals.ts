/**
 * Optionals in lowered code (§4.2, §10.4): `T?` is the union `T | None` (members/index.ts), and this is the one
 * place that tests one for `none`, for `none` itself, `??`, optional chains and a range's left-out
 * end, as their flows branch (lowering/flow/exits.ts).
 *
 * - `none` is the `None` member of the optional expected, or `null`, the one value of `None`, where
 *   `None` itself is.
 * - Reading one tests whether it is `none` and, where it isn't, carries on with it as the type the
 *   reader asks for: what remains without `None`, or the optional itself, as `a ?? b` gives when
 *   `b` is optional too.
 * - An instantiation may collapse an optional (§8.1): `T?` with `T = None` is `None`, whose one
 *   value is always absent, and with `T = Int?` is `Int?`, which a value of `T` is already, so it
 *   goes in as it is; with `T = any Sendable`, which takes `None` whole (§4.2), it is that `any`
 *   type, holding `none` as any other value (members/holdings.ts).
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { AnyType, Type, UnionType } from '../../checker/types/type/index.ts';
import { isPrimitive, noneType } from '../../checker/types/type/primitives.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext, TypedValue } from '../context.ts';
import type { Label } from '../functions/code-writer.ts';
import { laidOutAs } from './members/holdings.ts';
import { oneValueIn, outOfUnion } from './members/index.ts';
import { jumpIfHeld } from './members/tests.ts';

/** `none` as a value of `type`: an optional, `None` itself, or an `any` type that took it whole. */
export function noneOf(context: CodeContext, type: Type, span: AnchoredSpan): Register {
  return oneValueIn(context, type, noneType, span);
}

/** Jumps to `present` where the optional `value` holds a value, else to `none`. */
export function branchOnPresent(
  context: CodeContext,
  value: TypedValue,
  { present, none }: { readonly present: Label; readonly none: Label },
  span: AnchoredSpan,
): void {
  if (isPrimitive(value.type, 'None')) {
    context.code.jump(none, span);
  } else {
    const optional = { register: value.register, type: optionalType(value.type) };
    jumpIfHeld(context, { value: optional, member: noneType }, none, span);
    context.code.jump(present, span);
  }
}

/** The value inside the optional `read` reads, where it isn't `none`, as `read.to`. */
export function insideOptional(
  context: CodeContext,
  read: TypedValue & { readonly to: Type },
  span: AnchoredSpan,
): Register {
  if (isPrimitive(read.type, 'None')) {
    return read.register;
  }
  const optional = { register: read.register, type: optionalType(read.type) };
  return outOfUnion(context, optional, read.to, span);
}

/**
 * `type`, an optional the checker made sure of, not collapsed into `None`: a union holding it, or
 * the `any` type an instantiation collapsed it into.
 */
function optionalType(given: Type): UnionType | AnyType {
  const type = laidOutAs(given);
  if (type.kind !== 'union' && type.kind !== 'any') {
    unreachable(`Expected an optional, not a ${type.kind} type; the checker should have said so.`);
  }
  return type;
}
