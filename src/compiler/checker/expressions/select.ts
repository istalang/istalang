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
 * - A case on the function's own call's `disposing()` runs while the call is being disposed, so
 *   an `await` in its body stops the call instead of waiting (§7), which is warned about. The
 *   runtime decides cleanup by the future; the warning sees it where the case calls `disposing`
 *   on the function's own name, not through a variable holding that future.
 */

import { wellKnown } from '../../../language/well-known.ts';
import { valueBranchesOf } from '../../syntax/expressions/branches.ts';
import type { Expression, Select, SelectCase } from '../../syntax/expressions/index.ts';
import { selectCasesOf, unparenthesized } from '../../syntax/expressions/readings.ts';
import type { Accepts, BodyContext } from '../body-context.ts';
import { ownCallerOf } from '../closures/own-calls.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { Branches, branchesAccepts } from '../rules/branches.ts';
import { checkDiscarded } from '../rules/must-use.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { futureArgument } from '../types/well-known.ts';
import { reportWait } from './await.ts';

export function checkSelect(context: BodyContext, node: Select, expected: Type | undefined): Type {
  reportForm(context, node);
  const branches = new Branches(context, expected);
  for (const selectCase of selectCasesOf(node)) {
    checkCaseFuture(context, selectCase);
    if (watchesOwnDisposal(context, selectCase.future)) {
      context.functions.current.cleanup(() => branches.add(selectCase.body));
    } else {
      branches.add(selectCase.body);
    }
  }
  if (node.elseClause !== undefined) {
    branches.add(node.elseClause.body);
  }
  return branches.agreedType();
}

/** Whether `future` is the `disposing()` of the current function's own call (§7). */
function watchesOwnDisposal(context: BodyContext, future: Expression): boolean {
  const bare = unparenthesized(future);
  if (bare.kind !== 'Call' || bare.callee.kind !== 'MemberAccess') {
    return false;
  }
  const call = context.callAt(bare);
  const { module, name } = wellKnown.disposing;
  return (
    call?.kind === 'function' &&
    context.checker.languageFunctions(module, name).includes(call.function) &&
    ownCallerOf(context, bare.callee.target) === context.functions.current.function
  );
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

/** A `select` takes what its cases and its `else` agree on. */
export function selectAccepts(context: BodyContext, node: Select): Accepts | undefined {
  return branchesAccepts(context, valueBranchesOf(node));
}
