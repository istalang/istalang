/**
 * The loop every iterating construct runs (§3.10, §4; docs/arch/definition.md, "How each
 * construct lowers"): a `for`, a comprehension, and a spread its literal doesn't copy whole. Each
 * calls `iterate` on what it runs over, which gives a cursor, then calls the cursor until it gives
 * `none`, running the body with the item each `Some` holds. `iterate` is the call the checker made
 * for the construct (checker rules/iteration.ts), so there is one loop for all.
 */

import type { Register } from '../../definition/operands.ts';
import { optionalVariants } from '../../language/well-known.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Iteration } from '../checker/check.ts';
import type { Comprehension, Expression } from '../syntax/expressions/index.ts';
import type { For } from '../syntax/statements.ts';
import type { FunctionContext } from './context.ts';
import { emitCall } from './emit-call.ts';
import { implicitCall } from './expressions/calls.ts';
import { branchOnVariant, payloadOf, variantTestOf } from './expressions/variants.ts';
import type { LoopTargets } from './statements/loops.ts';
import { endScope } from './statements/scopes.ts';
import { bindTargets } from './statements/variables.ts';

/** The cursor `node` runs: `iterate` called on `iterable`'s value. */
export function cursorOf(
  context: FunctionContext,
  node: Iteration,
  iterable: Expression,
): Register {
  return implicitCall(context, node, 'iterate', [context.expression(iterable)]);
}

/**
 * Runs `body` for each item `cursor` gives, which `node` runs over: `body` receives the item's
 * register and where `continue` (the next item) and `break` (past the loop) go.
 */
export function emitLoop(
  context: FunctionContext,
  node: Iteration,
  cursor: Register,
  body: (item: Register, targets: LoopTargets) => void,
): void {
  const { code, checker } = context;
  const { span } = node;
  const next = code.newLabel();
  const element = code.newLabel();
  const exit = code.newLabel();
  code.place(next);
  const given = emitCall(context, {
    span,
    callee: { kind: 'value', register: cursor },
    arguments: [],
  });
  const form = context.body.iterationOf(node);
  if (form.kind !== 'cursor') {
    unreachable('A loop runs over a spread its literal copies whole.');
  }
  const optional = checker.optionalOf(form.item);
  const isSome = variantTestOf(checker, given, optional, optionalVariants.some);
  branchOnVariant(context, isSome, { matched: element, otherwise: exit }, span);
  code.place(element);
  const { depth } = context.variables;
  body(payloadOf(context, given, span), { exit, next, depth });
  code.jump(next, span);
  code.place(exit);
}

/**
 * Runs `body` for each item a `for` or a comprehension runs over, its targets bound to the item
 * in a scope of each pass's own (§3.4); `body` receives where `continue` and `break` go.
 */
export function emitLoopOver(
  context: FunctionContext,
  node: For | Comprehension,
  body: (targets: LoopTargets) => void,
): void {
  emitLoop(context, node, cursorOf(context, node, node.iterable), (item, targets) => {
    const { scope } = context.variables.inBlock(() => {
      bindTargets(context, node, item, node.span);
      body(targets);
    });
    endScope(context, scope, node.span);
  });
}
