/**
 * Optionals in lowered code (§2, §4): `T?` is the union `T | None` (unions.ts), and this is the one
 * place that tests one for `none`, for `none` itself, `!`, `??`, optional chains and a range's
 * left-out end.
 *
 * - `none` is the `None` member of the optional expected, or `null`, the one value of `None`, where
 *   `None` itself is.
 * - Reading one tests whether it is `none` and, where it isn't, carries on with it as the type the
 *   reader asks for: what remains without `None`, or the optional itself, as `a ?? b` gives when
 *   `b` is optional too.
 * - An instantiation may collapse an optional (§3.5): `T?` with `T = None` is `None`, whose one
 *   value is always absent, and with `T = Int?` is `Int?`, which a value of `T` is already, so it
 *   goes in as it is; with `T = any Sendable`, which takes `None` whole (§2), it is that `any`
 *   type, holding `none` as any other value (holdings.ts).
 */

import type { Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { sameType } from '../checker/types/identity/identity.ts';
import type { AnyType, Type, UnionType } from '../checker/types/type/index.ts';
import { isPrimitive, noneType } from '../checker/types/type/primitives.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { Label } from './code-writer.ts';
import type { CodeContext } from './context.ts';
import { jumpIfHeld, laidOutAs, type TypedValue } from './holdings.ts';
import { intoUnion, oneValueIn, outOfUnion } from './unions.ts';

/** A value of the optional type `type` in `register`, read as `to` where it isn't `none`. */
export interface OptionalRead {
  readonly register: Register;
  readonly type: Type;
  readonly to: Type;
}

/** `none` as a value of `type`: an optional, `None` itself, or an `any` type that took it whole. */
export function noneOf(context: CodeContext, type: Type, span: AnchoredSpan): Register {
  return oneValueIn(context, type, noneType, span);
}

/** `value` put into the optional type `optional` (§2), unless it is a value of it already. */
export function someOf(
  context: CodeContext,
  optional: Type,
  value: TypedValue,
  span: AnchoredSpan,
): Register {
  return sameType(value.type, optional)
    ? value.register
    : intoUnion(context, value, optionalType(optional), span);
}

/** Where the optional `read` reads isn't `none`, carries on with it as `read.to`; else jumps to `absent`. */
export function presentOrJump(
  context: CodeContext,
  read: OptionalRead,
  absent: Label,
  span: AnchoredSpan,
): Register {
  if (isPrimitive(read.type, 'None')) {
    context.code.jump(absent, span);
    return read.register;
  }
  const optional = { register: read.register, type: optionalType(read.type) };
  jumpIfHeld(context, { value: optional, member: noneType }, absent, span);
  return outOfUnion(context, optional, read.to, span);
}

/**
 * Where the optional `read` reads isn't `none`, carries on with it as `read.to`; else runs `absent`,
 * which writes what happens then and must leave the code.
 */
export function presentOr(
  context: CodeContext,
  read: OptionalRead,
  absent: () => void,
  span: AnchoredSpan,
): Register {
  const { code } = context;
  const missing = code.newLabel();
  const present = code.newLabel();
  const inside = presentOrJump(context, read, missing, span);
  code.jump(present, span);
  code.place(missing);
  absent();
  code.place(present);
  return inside;
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
