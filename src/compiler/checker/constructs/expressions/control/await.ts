/**
 * `await` (§14): waits on an awaitable and gives what it resolves its wait with. Only an async function
 * waits, because every await is a point where the instance commits and may suspend. In a case
 * cleaning up after the function's call is disposed, an await stops the call instead (§16), which is
 * warned about.
 *
 * - An `await`, and each `select` case, is the implicit call `onAwait(x, done)` (proposal 8, Rule 5),
 *   found as `for`'s `iterate` is (resolution/applying/implicit.ts), so any type with an `onAwait`
 *   is awaitable. `done` is a placeholder argument taking its parameter's type, `Resolver<T, M>`,
 *   which says what the wait gives, `T`, and its mode `M`, which must be the code's kind. A wait of
 *   another kind is reported as such, rather than as a call of another kind, and its call is left
 *   unjudged. A type parameter's awaitable waits in its `Mode`, which no kind equals: refused, as
 *   sound.
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import { awaitFunction } from '../../../../../foundation/language/well-known/implicit-calls.ts';
import type { Await, Expression, SelectCase } from '../../../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { callerName, kindText } from '../../../resolution/applying/call-kinds.ts';
import {
  applyImplicitCall,
  type ImplicitRequest,
  recordImplicitCall,
} from '../../../resolution/applying/implicit.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import { topLevelCandidates } from '../../../resolution/choosing/candidates.ts';
import { sameType } from '../../../types/identity/identity.ts';
import { isSimpleMark } from '../../../types/type/function-kinds.ts';
import type { AwaitedType } from '../../../types/type/function-types.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType, neverType, unitType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { futureOf, resolvedThrough } from '../../../types/type/well-known.ts';

export function checkAwait(context: BodyContext, node: Await, expected: Type | undefined): Type {
  reportWait(context, node.span);
  const expectedFuture =
    expected === undefined ? undefined : futureOf(context.checker, expected, context.codeKind);
  const operand = context.expression(node.operand, expectedFuture);
  const stopped = stoppedOperation(context, node, [{ node: node.operand, type: operand }]);
  if (stopped !== undefined) {
    return stopped;
  }
  const awaited = awaitedThrough(context, {
    node,
    operand: node.operand,
    type: operand,
    failure: () => checkerDiagnostics.awaitNeedsFuture(node.operand.span, typeText(operand)),
    checksKind: context.inAsync,
  });
  return awaited?.value ?? errorType;
}

/** A wait on `operand`, of `type`, at `node`, as its `onAwait` call is made. */
interface AwaitedOperand {
  readonly node: Await | SelectCase;
  readonly operand: Expression;
  readonly type: Type;
  /** What to report when no `onAwait` waits on it. */
  readonly failure: () => Diagnostic<AnchoredSpan>;
  /** Whether its kind is checked, and its call recorded: not where the wait is refused outright. */
  readonly checksKind: boolean;
}

/**
 * Makes the `onAwait` call of the wait `awaited` describes and checks its kind; what it gives and
 * in which mode, or undefined after a report. An operand of the error type was reported already,
 * and `Never`, which fits any parameter, awaits nothing. The `onAwait` chosen gives nothing, which
 * an async one or one giving a value doesn't (Rule 5).
 */
export function awaitedThrough(
  context: BodyContext,
  { node, operand, type, failure, checksKind }: AwaitedOperand,
): AwaitedType | undefined {
  if (type.kind === 'error') {
    return undefined;
  }
  if (sameType(type, neverType)) {
    context.report(failure());
    return undefined;
  }
  const request: ImplicitRequest = {
    node,
    span: operand.span,
    role: 'onAwait',
    candidates: topLevelCandidates(context.checker, context.module, awaitFunction, [type]),
    arguments: [
      { type, passing: 'value', node: operand },
      { type: undefined, passing: 'value' },
    ],
    failure,
  };
  const applied = applyImplicitCall(context, request);
  if (applied === undefined) {
    return undefined;
  }
  const [, done] = applied.filled;
  const awaited = done === undefined ? undefined : resolvedThrough(context.checker, done);
  if (awaited === undefined || !sameType(applied.result, unitType)) {
    context.report(failure());
    return undefined;
  }
  if (checksKind && checkWaitKind(context, operand.span, type, awaited.mode)) {
    recordImplicitCall(context, request, applied);
  }
  return awaited;
}

/**
 * Reports a wait at `at` on `found`, in `mode`, unless that is its function's kind: an `await`, and
 * a `select`'s case, blocking or not, waits in its function's kind (proposal 8, Rules 5 and 6), so
 * the kinds never meet. Whether it is.
 */
function checkWaitKind(context: BodyContext, at: AnchoredSpan, found: Type, mode: Type): boolean {
  context.functions.current.relyOnKind();
  const { codeKind } = context;
  if (sameType(mode, codeKind)) {
    return true;
  }
  context.report(
    isSimpleMark(codeKind) && mode.kind === 'literal'
      ? checkerDiagnostics.unmarkedWaits(
          at,
          callerName(context.functions.current),
          kindText(mode),
          typeText(found),
          context.inAsync ? 'async fn' : 'fn',
        )
      : checkerDiagnostics.waitOfOtherKind(at, typeText(found), kindText(codeKind)),
  );
  return false;
}

/** Reports a wait at `at` outside an async function, or where it stops a call being disposed. */
export function reportWait(context: BodyContext, at: AnchoredSpan): void {
  if (!context.inAsync) {
    context.report(checkerDiagnostics.awaitOutsideAsync(at));
  } else if (context.functions.current.inCleanup) {
    context.report(checkerDiagnostics.awaitInCleanup(at));
  }
}
