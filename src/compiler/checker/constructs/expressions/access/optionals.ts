/**
 * The operators on optionals (§4): `a?.b`, `a?.m()`, `a?->b`, `a ?? b` and `a!`.
 *
 * - `?.` and `?->` (with `?.[` and `?.(`) start an optional chain. Every link after one (`.c`,
 *   `.0`, `[i]`, `.m()`, `->c`) works on the value inside, and the whole chain yields `none` as
 *   soon as one of them meets `none`; parentheses end a chain, and so does a prefix `*`. The
 *   chain's value is wrapped into `T?` once, at its last link, unless it already is optional, so
 *   results never nest.
 * - A value read through `?.` or `?->` is a copy (§3.1), so a chain is never a place: it isn't
 *   assigned to, and a method taking `&self` isn't called through it.
 * - `a ?? b` is the value inside `a`, else `b`, evaluated only then. `b` may be a `T`, giving a
 *   `T`, or a `T?`, giving a `T?`, so `a ?? b ?? c` reads left to right.
 * - `a!` is `a ??` a panic (syntax/expressions/nullish.ts): the value inside `a`, panicking on none
 *   through the prelude's `panic`. A chain before it is unwrapped whole: `a?.b!` is `(a?.b)!`. It is
 *   a warning wherever it is written, since `??`, `is` or `match` handles the none it would panic on.
 * - All three take a type that may hold `none` (`presentType`): an optional, or a type whose `any`
 *   member took `None` whole, such as `any Sendable`; anything else is reported.
 */

import { panicFunction } from '../../../../../foundation/language/well-known/implicit-calls.ts';
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import {
  type ChainStep,
  chainStepOf,
  isOptionalStep,
} from '../../../../syntax/expressions/chains.ts';
import type { Binary, Expression, Unwrap } from '../../../../syntax/expressions/index.ts';
import { nullishOf } from '../../../../syntax/expressions/nullish.ts';
import type { BodyContext, Chains } from '../../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../../contexts/passes.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { preludeCall } from '../../../resolution/applying/implicit.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import type { ChainLink } from '../../../surface/checked-body.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType, isPrimitive, stringType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { optionalOf, presentType } from '../../../types/unions/unions.ts';

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
  readonly #bases: PassTable<Expression, Type>;
  readonly #carried: PassTable<Expression, Type>;
  readonly #links: PassTable<Expression, ChainLink>;

  constructor(passes: Passes) {
    this.#bases = passes.table();
    this.#carried = passes.table();
    this.#links = passes.table();
  }

  /**
   * Whether `node`, a link or not, continues an optional chain: it uses `?.`, or its target is a
   * link.
   */
  continues(node: Expression): boolean {
    const step = chainStepOf(node);
    return step !== undefined && (isOptionalStep(step) || this.#carried.has(step.target));
  }

  target(context: BodyContext, link: Expression): Type {
    const step = chainStepOf(link);
    if (step === undefined) {
      unreachable(`A ${link.kind} is no link; the checker asked the wrong node.`);
    }
    const targetType = context.settled(step.target);
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
    return value.kind === 'error' || presentType(value, context.checker.typeRules) !== undefined
      ? value
      : optionalOf(value, context.checker.typeRules);
  }

  chainOf(link: Expression, pass?: Pass): ChainLink | undefined {
    return this.#links.get(link, pass);
  }

  #baseOf(context: BodyContext, step: ChainStep, targetType: Type): Type {
    const carried = this.#carried.get(step.target) ?? targetType;
    if (!isOptionalStep(step) || carried.kind === 'error' || isPrimitive(carried, 'Never')) {
      return carried;
    }
    const inner = presentType(carried, context.checker.typeRules);
    if (inner === undefined) {
      context.report(
        checkerDiagnostics.needsOptional(step.target.span, step.operator, typeText(carried)),
      );
      return errorType;
    }
    return inner;
  }
}

/**
 * `a ?? b`, and `a!`, which reads as `a ??` a panic (`nullishOf`): the value inside the operand,
 * with what stands in for its `none` fitted to it, or to the operand's own optional type where only
 * that holds it; a panic stands in as `Never` does, warned of.
 */
export function checkNullish(
  context: BodyContext,
  node: Binary | Unwrap,
  expected: Type | undefined,
): Type {
  const { checker } = context;
  const { operand, operator, orElse } = nullishOf(node);
  const whole = context.expression(
    operand,
    expected === undefined ? undefined : optionalOf(expected, checker.typeRules),
  );
  if (orElse.kind === 'panic') {
    context.report(checkerDiagnostics.forceUnwrap(node.span));
  }
  const inner = presentType(whole, checker.typeRules);
  if (inner === undefined) {
    if (orElse.kind === 'value') {
      context.expression(orElse.value);
    }
    return (
      stoppedOperation(context, node, [{ node: operand, type: whole }]) ??
      reportedNeedsOptional(context, operand, operator, whole)
    );
  }
  if (orElse.kind === 'panic') {
    preludeCall(context, { node, role: 'panic', name: panicFunction, arguments: [stringType] });
    return inner;
  }
  const right = context.expression(orElse.value, expected ?? inner);
  if (checker.fitOf(right, inner) === undefined && checker.fitOf(right, whole) !== undefined) {
    context.fit(right, whole, orElse.value);
    return whole;
  }
  context.fit(right, inner, orElse.value);
  return inner;
}

/** Reports that `operand`, of `type`, is no optional for `operator` to work on; the error type. */
function reportedNeedsOptional(
  context: BodyContext,
  operand: Expression,
  operator: string,
  type: Type,
): Type {
  context.report(checkerDiagnostics.needsOptional(operand.span, operator, typeText(type)));
  return errorType;
}
