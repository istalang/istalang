/**
 * The operators on optionals (§4): `a?.b`, `a?.m()`, `a?->b`, `a ?? b` and `a!`.
 *
 * - `?.` and `?->` (with `?.[` and `?.(`) start an optional chain. Every link after one (`.c`,
 *   `.0`, `[i]`, `.m()`, `->c`) works on the value inside, and the whole chain yields `none` as soon
 *   as one of them meets `none`; parentheses end a chain, and so does a prefix `*`. The chain's
 *   value is wrapped into `T?` once, at its last link, unless it already is optional, so results
 *   never nest.
 * - A value read through `?.` or `?->` is a copy (§3.1), so a chain is never a place: it isn't
 *   assigned to, and a method taking `&self` isn't called through it.
 * - `a ?? b` is the value inside `a`, else `b`, evaluated only then. `b` may be a `T`, giving a `T`,
 *   or a `T?`, giving a `T?`, so `a ?? b ?? c` reads left to right.
 * - `a!` is the value inside `a`, and panics on none through the prelude's `panic`. A chain before
 *   it is unwrapped whole: `a?.b!` is `(a?.b)!`. It is a warning wherever it is written, since
 *   `??`, `is` or `match` handles the none it would panic on.
 * - All three take an optional; anything else is reported.
 */

import { panicFunction } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { type ChainStep, chainStepOf, isOptionalStep } from '../../syntax/expressions/chains.ts';
import type { Binary, Expression, Unwrap } from '../../syntax/expressions/index.ts';
import type { ChainLink } from '../check.ts';
import type { BodyContext, Chains } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { preludeCall } from '../resolution/implicit.ts';
import { errorType, stringType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { optionalInner, optionalOf } from '../types/unions.ts';

/**
 * The links of optional chains in one body: what each one's step works on, and the value it
 * carries along its chain, which the chain wraps if it ends there. A link's step is read from
 * syntax (`chainStepOf`); whether an expression is a link is decided here.
 *
 * A link's handler reads its target through `target` and nothing else: every expression's type
 * passes through `linked` (BodyChecker.expression), so no link kind can leave its chain unrecorded.
 */
export class OptionalChains implements Chains {
  /** The type each link's step works on, recorded when its handler reads its target. */
  readonly #bases = new Map<Expression, Type>();
  readonly #carried = new Map<Expression, Type>();
  readonly #links = new Map<Expression, ChainLink>();

  /** Whether `node`, a link or not, continues an optional chain: it uses `?.`, or its target is a link. */
  continues(node: Expression): boolean {
    const step = chainStepOf(node);
    return step !== undefined && (isOptionalStep(step) || this.#carried.has(step.target));
  }

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
    this.#carried.set(node, value);
    this.#links.set(node, { base, carried: value });
    return value.kind === 'error' || optionalInner(value) !== undefined
      ? value
      : optionalOf(value, context.checker.typeRules);
  }

  chainOf(link: Expression): ChainLink | undefined {
    return this.#links.get(link);
  }

  #baseOf(context: BodyContext, step: ChainStep, targetType: Type): Type {
    const carried = this.#carried.get(step.target) ?? targetType;
    if (!isOptionalStep(step) || carried.kind === 'error') {
      return carried;
    }
    const inner = optionalInner(carried);
    if (inner === undefined) {
      context.report(
        checkerDiagnostics.needsOptional(step.target.span, step.operator, typeText(carried)),
      );
      return errorType;
    }
    return inner;
  }
}

/** `a!`: the value inside `a`, which must be an optional. */
export function checkUnwrap(context: BodyContext, node: Unwrap, expected: Type | undefined): Type {
  const operand = context.expression(
    node.operand,
    expected === undefined ? undefined : optionalOf(expected, context.checker.typeRules),
  );
  context.report(checkerDiagnostics.forceUnwrap(node.span));
  const inner = optionalInner(operand);
  if (inner === undefined) {
    if (operand.kind !== 'error') {
      context.report(checkerDiagnostics.needsOptional(node.operand.span, '!', typeText(operand)));
    }
    return errorType;
  }
  preludeCall(context, {
    node,
    role: 'panic',
    name: panicFunction,
    arguments: [stringType],
  });
  return inner;
}

/** `a ?? b`. */
export function checkNullish(context: BodyContext, node: Binary, expected: Type | undefined): Type {
  const { checker } = context;
  const left = context.expression(
    node.left,
    expected === undefined ? undefined : optionalOf(expected, checker.typeRules),
  );
  const inner = optionalInner(left);
  if (inner === undefined) {
    if (left.kind !== 'error') {
      context.report(checkerDiagnostics.needsOptional(node.left.span, '??', typeText(left)));
    }
    context.expression(node.right);
    return errorType;
  }
  const right = context.expression(node.right, expected ?? inner);
  if (checker.fitOf(right, inner) === undefined && checker.fitOf(right, left) !== undefined) {
    context.fit(right, left, node.right);
    return left;
  }
  context.fit(right, inner, node.right);
  return inner;
}
