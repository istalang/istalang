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
 */

import type { Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { noneType, type Type, type UnionType } from '../checker/types/type.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { Label } from './code-writer.ts';
import { emitConstant } from './constants.ts';
import type { CodeContext } from './context.ts';
import { intoUnion, jumpIfMember, oneValueIn, outOfUnion, type TypedValue } from './unions.ts';

/** A value of the optional type `type` in `register`, read as `to` where it isn't `none`. */
export interface OptionalRead {
  readonly register: Register;
  readonly type: Type;
  readonly to: Type;
}

/** `none` as a value of `type`: an optional, or `None` itself. */
export function noneOf(context: CodeContext, type: Type, span: AnchoredSpan): Register {
  return type.kind === 'union'
    ? oneValueIn(context, type, noneType, span)
    : emitConstant(context, null, span);
}

/** `value` put into the optional type `optional` (§2). */
export function someOf(
  context: CodeContext,
  optional: Type,
  value: TypedValue,
  span: AnchoredSpan,
): Register {
  return intoUnion(context, value, optionalType(optional), span);
}

/** Where the optional `read` reads isn't `none`, carries on with it as `read.to`; else jumps to `absent`. */
export function presentOrJump(
  context: CodeContext,
  read: OptionalRead,
  absent: Label,
  span: AnchoredSpan,
): Register {
  const optional = { register: read.register, type: optionalType(read.type) };
  jumpIfMember(context, { value: optional, member: noneType }, absent, span);
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

/** `type`, which the checker made sure is optional: a union holding `None`. */
function optionalType(type: Type): UnionType {
  if (type.kind !== 'union') {
    unreachable(`Expected an optional, not a ${type.kind} type; the checker should have said so.`);
  }
  return type;
}
