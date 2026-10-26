/**
 * Optional chains (§4): `a?.b`, `a?.m()`, `a?->b`, and the links after them, such as `.c` in
 * `a?.b.c`.
 *
 * - A chain is lowered from its last link, the only one lowered as an expression: its result
 *   register gets the chain's value, wrapped into `Some` unless already optional, or `None` when
 *   a `?.` or `?->` meets `None`, which jumps straight to the chain's end. Inner links are
 *   lowered as links, working on the value carried along, so nothing between them is ever
 *   wrapped.
 * - A link reads its target through `target`: a chained target is lowered as a link, and a `?.`
 *   or `?->` switches on the value, carrying on with the value inside `Some`. What each link works
 *   on is the checker's record (`chainOf`), so nothing here re-derives a type.
 */

import type { Register } from '../../definition/operands.ts';
import { optionalVariants } from '../../language/well-known.ts';
import { withPushed } from '../../structures/stack.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { chainStepOf, type Expression, isOptionalStep } from '../syntax/expressions.ts';
import type { Label } from './code-writer.ts';
import type { FunctionContext } from './context.ts';
import {
  branchOnVariant,
  buildVariant,
  isEnum,
  payloadOf,
  variantTestOf,
} from './expressions/variants.ts';

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
    const type = context.body.typeOf(link);
    if (!isEnum(type)) {
      unreachable(`A chain at ${link.span.start} isn't optional; the checker should have said so.`);
    }
    const result = code.allocate();
    const none = code.newLabel();
    const end = code.newLabel();
    const value = withPushed(this.#ends, none, () => this.#link(link));
    const wrapped =
      context.body.chainOf(link)?.wraps === true
        ? buildVariant(context, { type, name: optionalVariants.some }, [value], link.span)
        : value;
    code.emit({ kind: 'move', span: link.span, dst: result, src: wrapped });
    code.jump(end, link.span);
    code.place(none);
    const nothing = buildVariant(context, { type, name: optionalVariants.none }, [], link.span);
    code.emit({ kind: 'move', span: link.span, dst: result, src: nothing });
    code.place(end);
    return result;
  }

  /** The register the step of `link` works on: its target's value, the value inside after `?.`. */
  target(context: FunctionContext, link: Expression): Register {
    const step = chainStepOf(link);
    if (step === undefined) {
      unreachable(`A ${link.kind} is no link; lowering asked the wrong node.`);
    }
    const { body } = context;
    const value =
      body.chainOf(step.target) === undefined
        ? context.expression(step.target)
        : this.#link(step.target);
    const base = body.chainOf(link)?.base;
    const none = this.#ends.at(-1);
    if (!isOptionalStep(step)) {
      return value;
    }
    if (base === undefined || none === undefined) {
      unreachable(`A '?.' at ${link.span.start} is outside a chain; lowering lost track of it.`);
    }
    const some = context.code.newLabel();
    const optional = context.checker.optionalOf(base);
    const isSome = variantTestOf(context.checker, value, optional, optionalVariants.some);
    branchOnVariant(context, isSome, { matched: some, otherwise: none }, link.span);
    context.code.place(some);
    return payloadOf(context, value, link.span);
  }
}
