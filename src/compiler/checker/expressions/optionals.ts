/**
 * The operators on optionals (§4): `a?.b`, `a?.m()`, and `a ?? b`.
 *
 * - `?.` starts an optional chain. Every link after it (`.c`, `.0`, `[i]`, `.m()`) works on the
 *   value inside, and the whole chain yields `none` as soon as one `?.` meets `none`; parentheses
 *   end a chain. The chain's value is wrapped into `T?` once, at its last link, unless it already
 *   is optional, so results never nest.
 * - A value read through `?.` is a copy (§3.1), so a chain is never a place: it isn't assigned to,
 *   and a method taking `&self` isn't called through it.
 * - `a ?? b` is the value inside `a`, else `b`, evaluated only then. `b` may be a `T`, giving a `T`,
 *   or a `T?`, giving a `T?`, so `a ?? b ?? c` reads left to right.
 * - Both take an optional; anything else is reported.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import {
  type Binary,
  type ChainStep,
  chainStepOf,
  type Expression,
} from '../../syntax/expressions.ts';
import type { ChainLink } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { optionalInner } from '../types/fit.ts';
import { errorType, isAssignable, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/**
 * The links of optional chains in one body: what each one's step works on, the value it carries
 * along its chain, and whether the chain wraps that value if it ends there. A link's step is read
 * from syntax (`chainStepOf`); whether an expression is a link is decided here.
 *
 * A link's handler reads its target through `target` and nothing else: every expression's type
 * passes through `linked` (BodyChecker.expression), so no link kind can leave its chain unrecorded.
 */
export class OptionalChains {
  /** The type each link's step works on, recorded when its handler reads its target. */
  readonly #bases = new Map<Expression, Type>();
  readonly #carried = new Map<Expression, Type>();
  readonly #links = new Map<Expression, ChainLink>();

  /** Whether `node`, a link or not, continues an optional chain: it uses `?.`, or its target is a link. */
  continues(node: Expression): boolean {
    const step = chainStepOf(node);
    return step !== undefined && (step.optional || this.#carried.has(step.target));
  }

  /**
   * Checks the target of `link`'s step; the type the step works on: the value a chained target
   * carries, the value inside an optional after `?.`, or the error type after a report.
   */
  target(context: BodyContext, link: Expression): Type {
    const step = chainStepOf(link);
    if (step === undefined) {
      unreachable(`A ${link.kind} is no link; the checker asked the wrong node.`);
    }
    const targetType = context.expression(step.target);
    if (!this.continues(link)) {
      return targetType;
    }
    const base = this.#baseOf(context, step, targetType);
    this.#bases.set(link, base);
    return base;
  }

  /**
   * The type of `node`, whose handler gave `value`: for a link of a chain, the chain's value so
   * far, wrapped into `T?` unless already optional; `value` itself for any other expression.
   */
  linked(context: BodyContext, node: Expression, value: Type): Type {
    const base = this.#bases.get(node);
    if (base === undefined) {
      return value;
    }
    const { checker } = context;
    const wraps =
      value.kind !== 'error' && optionalInner(value, checker.optionalEntity) === undefined;
    this.#carried.set(node, value);
    this.#links.set(node, { base, wraps });
    return wraps ? checker.optionalOf(value) : value;
  }

  chainOf(link: Expression): ChainLink | undefined {
    return this.#links.get(link);
  }

  #baseOf(context: BodyContext, step: ChainStep, targetType: Type): Type {
    const carried = this.#carried.get(step.target) ?? targetType;
    if (!step.optional || carried.kind === 'error') {
      return carried;
    }
    const inner = optionalInner(carried, context.checker.optionalEntity);
    if (inner === undefined) {
      context.report(checkerDiagnostics.needsOptional(step.target.span, '?.', typeText(carried)));
      return errorType;
    }
    return inner;
  }
}

/** `a ?? b`. */
export function checkNullish(context: BodyContext, node: Binary, expected: Type | undefined): Type {
  const { checker } = context;
  const left = context.expression(
    node.left,
    expected === undefined ? undefined : checker.optionalOf(expected),
  );
  const inner = optionalInner(left, checker.optionalEntity);
  if (inner === undefined) {
    if (left.kind !== 'error') {
      context.report(checkerDiagnostics.needsOptional(node.left.span, '??', typeText(left)));
    }
    context.expression(node.right);
    return errorType;
  }
  const right = context.expression(node.right, expected ?? inner);
  if (checker.wrapsToFit(right, inner) === undefined && isAssignable(right, left)) {
    return left;
  }
  context.fit(right, inner, node.right);
  return inner;
}
