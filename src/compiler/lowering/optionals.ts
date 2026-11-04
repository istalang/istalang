/**
 * Optionals in lowered code (§2, §4): the one place that knows how a value of `T?` is laid out,
 * which `none`, the wrap into `T?`, `!`, `??`, optional chains, a range's left-out end and a loop
 * over a cursor all go through.
 *
 * - A `T?` is the prelude's enum `Optional<T>`: `None`, or `Some` holding the value.
 * - Reading one tests whether it is `none` and, where it isn't, carries on with its value as the
 *   type the reader asks for: the type inside, or the optional itself, as `a ?? b` gives when `b`
 *   is optional too.
 */

import type { Register } from '../../definition/operands.ts';
import { optionalVariants } from '../../language/well-known.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { sameType } from '../checker/types/identity.ts';
import type { NominalType, Type } from '../checker/types/type.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { Label } from './code-writer.ts';
import type { CodeContext } from './context.ts';
import { buildVariant, isEnum, payloadOr, payloadOrJump } from './expressions/variants.ts';

/** A value of the optional type `type` in `register`, read as `to` where it isn't `none`. */
export interface OptionalRead {
  readonly register: Register;
  readonly type: Type;
  readonly to: Type;
}

/** `none` of the optional type `type`. */
export function noneOf(context: CodeContext, type: Type, span: AnchoredSpan): Register {
  return buildVariant(context, { type: optionalType(type), name: optionalVariants.none }, [], span);
}

/** `value` wrapped into the optional type `type` (§2). */
export function someOf(
  context: CodeContext,
  type: Type,
  value: Register,
  span: AnchoredSpan,
): Register {
  const some = { type: optionalType(type), name: optionalVariants.some };
  return buildVariant(context, some, [value], span);
}

/** Where the optional `read` reads isn't `none`, carries on with it as `read.to`; else jumps to `absent`. */
export function presentOrJump(
  context: CodeContext,
  read: OptionalRead,
  absent: Label,
  span: AnchoredSpan,
): Register {
  return as(read, payloadOrJump(context, someCase(read), absent, span));
}

/**
 * Where the optional `read` reads isn't `none`, carries on with it as `read.to`; else runs `absent`, which
 * writes what happens then and must leave the code.
 */
export function presentOr(
  context: CodeContext,
  read: OptionalRead,
  absent: () => void,
  span: AnchoredSpan,
): Register {
  return as(read, payloadOr(context, someCase(read), absent, span));
}

/** The test for the optional `read` reads holding a value. */
function someCase(read: OptionalRead) {
  return { register: read.register, type: optionalType(read.type), name: optionalVariants.some };
}

/** A present optional as `read.to`: the optional itself where that is its own type, else `inside`. */
function as(read: OptionalRead, inside: Register): Register {
  return sameType(read.to, read.type) ? read.register : inside;
}

/** `type`, which the checker made sure is optional. */
function optionalType(type: Type): NominalType {
  if (!isEnum(type)) {
    unreachable(`Expected an optional, not a ${type.kind} type; the checker should have said so.`);
  }
  return type;
}
