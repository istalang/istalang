/**
 * `select` (§8): races futures and runs the case of the first to resolve.
 *
 * - `await select` waits, so only an async function writes one, and it has no `else`. A `select`
 *   without `await` never waits, so any function may write one, and it needs `else`, which runs
 *   when no case's future has resolved.
 * - Each case's expression is a future, checked in source order before its body. `as name` binds
 *   the future's value; a case without `as` discards it, so a value that must be used (§7), such
 *   as a `Result`, is reported as a bare expression's would be.
 * - The case bodies and `else` agree on the select's type as an `if`'s branches do
 *   (rules/branches.ts).
 * - A case on the function's own `disposing()` runs while its call is being disposed, so an
 *   `await` in its body stops the call instead of waiting (§7), which is warned about.
 */

import { type Select, type SelectCase, unparenthesized } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { Branches } from '../rules/branches.ts';
import { futureArgument } from '../rules/futures.ts';
import { checkDiscarded } from '../rules/must-use.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { reportWait } from './await.ts';

export function checkSelect(context: BodyContext, node: Select, expected: Type | undefined): Type {
  reportForm(context, node);
  const branches = new Branches(context, expected);
  for (const selectCase of node.cases) {
    if (selectCase.kind === 'SelectCase') {
      checkCaseFuture(context, selectCase);
      const scope = context.functions.current;
      const future = unparenthesized(selectCase.future);
      const cleansUp =
        future.kind === 'Call' && context.ownCalls.watchedAt(future)?.owner === scope.function;
      if (cleansUp) {
        scope.cleanup(() => branches.add(selectCase.body));
      } else {
        branches.add(selectCase.body);
      }
    }
  }
  if (node.elseClause !== undefined) {
    branches.add(node.elseClause.body);
  }
  return branches.agreedType();
}

/** Reports a select that waits outside an async function, or has `else` exactly when it waits. */
function reportForm(context: BodyContext, node: Select): void {
  if (node.awaits) {
    reportWait(context, node.span);
  }
  if (node.awaits && node.elseClause !== undefined) {
    context.report(checkerDiagnostics.awaitedSelectElse(node.elseClause.span));
  }
  if (!(node.awaits || node.elseClause !== undefined)) {
    context.report(checkerDiagnostics.selectWithoutElse(node.span));
  }
}

/** Checks a case's future, and binds or discards the value it gives. */
function checkCaseFuture(context: BodyContext, selectCase: SelectCase): void {
  const future = context.expression(selectCase.future);
  const value = futureArgument(context.checker, future);
  if (value === undefined && future.kind !== 'error') {
    context.report(checkerDiagnostics.caseNeedsFuture(selectCase.future.span, typeText(future)));
  }
  if (selectCase.binding !== undefined) {
    const type = value ?? errorType;
    context.variables.declare(selectCase.binding, type);
    context.variables.recordTargets(selectCase, [{ name: selectCase.binding, type, path: [] }]);
  } else if (value !== undefined) {
    checkDiscarded(context, selectCase.future, value);
  }
}
