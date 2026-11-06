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
 *
 * Optional chains (§4): `a?.b`, `a?.m()`, `a?->b`, and the links after them, such as `.c` in
 * `a?.b.c`.
 *
 * - A chain is lowered from its last link, the only one lowered as an expression: its result
 *   register gets the chain's value, put into the chain's optional unless a value of it already
 *   (`someOf`), or `none` when a `?.` or `?->` meets `none`, which jumps straight to the chain's
 *   end. Inner links are lowered as links, working on the value carried along, so nothing between
 *   them is ever wrapped.
 * - A link reads its target through `target`: lowered by its handler, a chained target as a link,
 *   and a `?.` or `?->` switches on the value, carrying on with the value beside `none`, which is
 *   then fitted as the checker fitted it. What each link works on is the checker's record
 *   (`chainOf`), so nothing here re-derives a type.
 */

import type { Register } from '../../../definition/operands.ts';
import { withPushed } from '../../../foundation/structures/stack.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { sameType } from '../../checker/types/identity/identity.ts';
import type { AnyType, Type, UnionType } from '../../checker/types/type/index.ts';
import { isPrimitive, noneType } from '../../checker/types/type/primitives.ts';
import { optionalOf } from '../../checker/types/unions/unions.ts';
import { chainStepOf, isOptionalStep } from '../../syntax/expressions/chains.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext, FunctionContext } from '../context.ts';
import type { Label } from '../functions/code-writer.ts';
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

/**
 * Where the optional `read` reads isn't `none`, carries on with it as `read.to`; else jumps to
 * `absent`.
 */
function presentOrJump(
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
 * Where the optional `read` reads isn't `none`, carries on with it as `read.to`; else runs
 * `absent`, which writes what happens then and must leave the code.
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

export class OptionalChains {
  readonly #link: (node: Expression) => Register;
  /** Where a `?.` meeting `None` goes, per chain being lowered, innermost last. */
  readonly #ends: Label[] = [];

  /** `link` lowers an expression as a link: by its handler, outside any chain wrapping. */
  constructor(link: (node: Expression) => Register) {
    this.#link = link;
  }

  /** Lowers `link`, the last link of a chain; the register of the chain's value. */
  lower(context: FunctionContext, link: Expression): Register {
    const { code } = context;
    const type = context.typeOf(link);
    const result = code.allocate();
    const none = code.newLabel();
    const end = code.newLabel();
    const value = withPushed(this.#ends, none, () => this.#link(link));
    const carried = context.body.chainOf(link)?.carried ?? type;
    const wrapped = someOf(context, type, { register: value, type: carried }, link.span);
    code.emit({ kind: 'move', span: link.span, dst: result, src: wrapped });
    code.jump(end, link.span);
    code.place(none);
    const nothing = noneOf(context, type, link.span);
    code.emit({ kind: 'move', span: link.span, dst: result, src: nothing });
    code.place(end);
    return result;
  }

  /**
   * The register the step of `link` works on: its target's value, the value inside after `?.`,
   * made to fit as the checker fitted what the step works on (a receiver converted for the method
   * a call chose, §2), which is the value inside after `?.`, never the optional around it.
   */
  target(context: FunctionContext, link: Expression): Register {
    const step = chainStepOf(link);
    if (step === undefined) {
      unreachable(`A ${link.kind} is no link; lowering asked the wrong node.`);
    }
    const { body } = context;
    const value = this.#link(step.target);
    const fit = body.fitAt(step.target);
    const base = body.chainOf(link)?.base;
    if (!isOptionalStep(step)) {
      return context.fitted(value, base ?? context.typeOf(step.target), fit, step.target);
    }
    const none = this.#ends.at(-1);
    if (base === undefined || none === undefined) {
      unreachable(`A '?.' at ${link.span.from} is outside a chain; lowering lost track of it.`);
    }
    const read = { register: value, type: optionalOf(base, context.checker.typeRules), to: base };
    const inside = presentOrJump(context, read, none, link.span);
    return context.fitted(inside, base, fit, step.target);
  }
}
