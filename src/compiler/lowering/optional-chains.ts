/**
 * Optional chains (§4): `a?.b`, `a?.m()`, `a?->b`, and the links after them, such as `.c` in
 * `a?.b.c`.
 *
 * - A chain is lowered from its last link, the only one lowered as an expression: its result
 *   register gets the chain's value, wrapped into `Some` unless already optional, or `None` when
 *   a `?.` or `?->` meets `None`, which jumps straight to the chain's end. Inner links are
 *   lowered as links, working on the value carried along, so nothing between them is ever
 *   wrapped.
 * - A link reads its target through `target`: lowered by its handler, a chained target as a link,
 *   and a `?.` or `?->` switches on the value, carrying on with the value inside `Some`, which is
 *   then fitted as the checker fitted it. What each link works on is the checker's record
 *   (`chainOf`), so nothing here re-derives a type.
 */

import type { Register } from '../../definition/operands.ts';
import { withPushed } from '../../structures/stack.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { chainStepOf, isOptionalStep } from '../syntax/expressions/chains.ts';
import type { Expression } from '../syntax/expressions/index.ts';
import type { Label } from './code-writer.ts';
import type { FunctionContext } from './context.ts';
import { noneOf, presentOrJump, someOf } from './optionals.ts';

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
    const wrapped =
      context.body.chainOf(link)?.wraps === true ? someOf(context, type, value, link.span) : value;
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
    const read = { register: value, type: context.checker.optionalOf(base), to: base };
    const inside = presentOrJump(context, read, none, link.span);
    return context.fitted(inside, base, fit, step.target);
  }
}
