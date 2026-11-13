/**
 * The loop every iterating construct runs (§3.10, §4; docs/arch/definition.md, "How each
 * construct lowers"): a `for`, a comprehension, and a spread its literal doesn't copy whole. Each
 * calls `iterate` on what it runs over, which gives a cursor, then calls the cursor until it gives
 * `Done`, running the body with the item each `Next` holds. `iterate` is the call the checker made
 * for the construct (checker constructs/loops/iteration.ts), so there is one loop for all.
 */

import type { Register } from '../../../../definition/operands.ts';
import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { stepVariants } from '../../../../foundation/language/well-known/variants.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Iteration, IterationForm } from '../../../checker/surface/checked-body.ts';
import type { Comprehension, Expression } from '../../../syntax/expressions/index.ts';
import type { For } from '../../../syntax/statements/index.ts';
import { emitCall, emitImplicitCall } from '../../calls/emit-call.ts';
import type { FunctionContext } from '../../context.ts';
import { payloadOr } from '../../values/variant-values.ts';
import type { LoopTargets } from '../statements/loops.ts';
import { endScope } from '../statements/scopes.ts';
import { bindTargets } from '../statements/variables.ts';

/** The cursor `node` runs: `iterate` called on `iterable`'s value. */
export function cursorOf(
  context: FunctionContext,
  node: Iteration,
  iterable: Expression,
): Register {
  return emitImplicitCall(context, node, 'iterate', [context.expression(iterable)]);
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
  const exit = code.newLabel();
  code.place(next);
  const given = emitCall(context, {
    span,
    callee: { kind: 'value', register: cursor },
    arguments: [],
  });
  const form = iterationFormOf(context, node);
  if (form.kind !== 'cursor') {
    unreachable('A loop runs over a spread its literal copies whole.');
  }
  const step =
    checker.wellKnownType(wellKnown.step, [form.item]) ??
    unreachable('A cursor gives a Step, which only a program with a prelude has.');
  const tested = { register: given, type: step, name: stepVariants.next };
  const item = payloadOr(context, tested, () => code.jump(exit, span), span);
  const { depth } = context.variables;
  body(item, { exit, next, depth });
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

/** How `node` runs, as checking recorded it; lowering runs only on a program checked clean. */
export function iterationFormOf(context: FunctionContext, node: Iteration): IterationForm {
  return (
    context.body.iterationOf(node) ??
    unreachable(`An iteration at ${node.span.from} was never checked.`)
  );
}
