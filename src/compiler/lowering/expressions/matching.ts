/**
 * `match` and `is` (§3.11, §4): each runs a pattern's tests (patterns.ts) on its subject,
 * evaluated once.
 *
 * - A `match` tries its cases in order. A case's tests jump to the next case when one fails; its
 *   bindings are then declared, its guard tested, and its body's value written to the result
 *   register. The checker found the cases exhaustive, so falling past the last case never happens.
 * - Each case is a scope of its own (§3.4): its bindings end with its body, or when its guard
 *   fails. The subject's temporaries end once a case's body is entered (§7).
 * - `x is P` writes whether the tests passed, declaring the bindings on the passing path, where
 *   the binder lets them be read.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Is, Match } from '../../syntax/expressions/index.ts';
import { casesOf } from '../../syntax/expressions/readings.ts';
import type { FunctionContext } from '../context.ts';
import { lowerMatching } from '../patterns.ts';
import { endScope, headerTemporaries, lowerGuarded, release } from '../statements/scopes.ts';

export function lowerMatch(context: FunctionContext, node: Match): Register {
  const { code } = context;
  const subject = headerTemporaries(context, () => context.expression(node.subject));
  const result = code.allocate();
  const end = code.newLabel();
  for (const matchCase of casesOf(node)) {
    const next = code.newLabel();
    const pattern = context.patternOf(matchCase.pattern);
    const matching = { subject: subject.result, pattern };
    const enter = () => {
      lowerMatching(context, matching, next, matchCase.pattern.span);
    };
    const body = () => {
      release(context, subject.temporaries, node.subject.span);
      const value = context.block(matchCase.body);
      code.emit({ kind: 'move', span: matchCase.body.span, dst: result, src: value });
    };
    const leave = () => {
      code.jump(end, matchCase.span);
    };
    const { guard } = matchCase;
    if (guard === undefined) {
      const { scope } = context.variables.inBlock(() => {
        enter();
        body();
      });
      endScope(context, scope, matchCase.body.span);
      leave();
    } else {
      const header = () => context.expression(guard);
      lowerGuarded(context, { before: enter, header, body, leave, span: matchCase.span });
      code.jump(next, matchCase.span);
    }
    code.place(next);
  }
  code.place(end);
  return result;
}

export function lowerIs(context: FunctionContext, node: Is): Register {
  const matching = {
    subject: context.expression(node.subject),
    pattern: context.patternOf(node.pattern),
  };
  const result = context.code.allocate();
  const fail = context.code.newLabel();
  const end = context.code.newLabel();
  lowerMatching(context, matching, fail, node.span);
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
