/**
 * `match` and `is` (§3.11, §4): each runs a pattern's tests (patterns.ts) on its subject,
 * evaluated once.
 *
 * - A `match` tries its cases in order. A case's tests jump to the next case when one fails; its
 *   bindings are then declared, its guard tested, and its body's value written to the result
 *   register. The checker found the cases exhaustive, so falling past the last case never happens.
 * - `x is P` writes whether the tests passed, declaring the bindings on the passing path, where
 *   the binder lets them be read.
 */

import type { Register } from '../../../definition/operands.ts';
import { casesOf, type Is, type Match } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { lowerBindings, lowerTests } from '../patterns.ts';

export function lowerMatch(context: FunctionContext, node: Match): Register {
  const subject = context.expression(node.subject);
  const result = context.code.allocate();
  const end = context.code.newLabel();
  for (const matchCase of casesOf(node)) {
    const next = context.code.newLabel();
    const matching = { subject, pattern: context.body.patternOf(matchCase.pattern) };
    lowerTests(context, matching, next, matchCase.pattern.span);
    lowerBindings(context, matching, matchCase.pattern.span);
    if (matchCase.guard !== undefined) {
      const body = context.code.newLabel();
      context.code.branch(context.expression(matchCase.guard), body, next, matchCase.guard.span);
      context.code.place(body);
    }
    const value = context.block(matchCase.body);
    context.code.emit({ kind: 'move', span: matchCase.body.span, dst: result, src: value });
    context.code.jump(end, matchCase.span);
    context.code.place(next);
  }
  context.code.place(end);
  return result;
}

export function lowerIs(context: FunctionContext, node: Is): Register {
  const matching = {
    subject: context.expression(node.subject),
    pattern: context.body.patternOf(node.pattern),
  };
  const result = context.code.allocate();
  const fail = context.code.newLabel();
  const end = context.code.newLabel();
  lowerTests(context, matching, fail, node.span);
  lowerBindings(context, matching, node.span);
  context.code.emit({
    kind: 'move',
    span: node.span,
    dst: result,
    src: context.constant(true, node.span),
  });
  context.code.jump(end, node.span);
  context.code.place(fail);
  context.code.emit({
    kind: 'move',
    span: node.span,
    dst: result,
    src: context.constant(false, node.span),
  });
  context.code.place(end);
  return result;
}
