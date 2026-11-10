/**
 * The call rule (proposal 8, Rule 2): in code of a kind, every function called is unmarked or of
 * that kind, so ista code calls nothing live and live code nothing ista. It is checked where each
 * call is made, against the kind of the function the call stands in, never across the program.
 *
 * - A kind admits a callee that either kind may call (an unmarked one) or one of its own: the same
 *   kind, or the same kind variable, which an unmarked callee's own settles to at the call.
 * - Code of no kind of its own, an unmarked function's or a constant's, calling something of a
 *   kind is the function missing its mark, which the error says to write; code of a kind calling
 *   the other kind is the two kinds meeting, which no mark mends.
 */

import { declaredFunctionName } from '../../../syntax/declarations/field-defaults.ts';
import { functionTypeParametersOf } from '../../../syntax/declarations/function-kinds.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { BodyContext, FunctionFrame } from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { FunctionCall, ResolvedCall } from '../../surface/resolved-call.ts';
import { sameType } from '../../types/identity/identity.ts';
import { substitute, substitutionFor } from '../../types/parts/substitution.ts';
import { ownValueKindOf } from '../../types/properties/value-kinds.ts';
import { kindAdmits, kindOfFunction } from '../../types/type/function-kinds.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';
import { callMade } from '../choosing/calls-made.ts';
import type { Application } from '../choosing/choice.ts';

/** The kind of the function `call` calls, as the call instantiates it. */
export function kindOfCall(checker: CheckerContext, call: ResolvedCall): Type {
  const own = substitutionFor(functionTypeParametersOf(call.function), call.typeArguments);
  return substitute(kindOfFunction(checker, call.function), own, checker.typeRules);
}

/**
 * The call `application` makes, as `instantiation` settles it, judged by the call rule where `at`
 * makes it in `frame`: the one seam every call the checker records goes through, written or made
 * for a construct (an operator's function, `iterate`, `toString`).
 */
export function judgedCall(
  context: Pick<BodyContext, 'report' | 'checker'>,
  made: {
    readonly at: AnchoredSpan;
    readonly frame: FunctionFrame;
    readonly application: Pick<Application, 'candidate' | 'binding'>;
    readonly instantiation: Pick<FunctionCall, 'typeArguments' | 'witnesses'>;
  },
): ResolvedCall {
  const call = callMade(made.application, made.instantiation);
  checkCallKind(context, {
    at: made.at,
    frame: made.frame,
    calleeKind: kindOfCall(context.checker, call),
    callee: `'${declaredFunctionName(call.function)}'`,
  });
  return call;
}

/** A call to judge: where it is, the function whose code makes it, what it calls and its kind. */
export interface CallOfKind {
  readonly at: AnchoredSpan;
  /** The function making the call, as it was when the call was made, which may complete later. */
  readonly frame: FunctionFrame;
  readonly calleeKind: Type;
  readonly callee: string;
}

/**
 * Reports `call` where its code's kind refuses it; a callee of a kind makes the code depend on its
 * own.
 */
export function checkCallKind(context: Pick<BodyContext, 'report'>, call: CallOfKind): void {
  const { at, frame, calleeKind, callee } = call;
  const caller = frame.codeKind;
  if (calleeKind.kind !== 'union') {
    frame.relyOnKind();
  }
  if (kindAdmits(caller, calleeKind, sameType)) {
    return;
  }
  context.report(
    caller.kind === 'literal'
      ? checkerDiagnostics.kindsMeet(at, kindText(caller), kindText(calleeKind), callee)
      : checkerDiagnostics.unmarkedCalls(at, callerName(frame), kindText(calleeKind), callee),
  );
}

/**
 * Reports a value of `type` that code makes at `at` where the value is of a kind its code's kind
 * refuses: releasing a value whose `dispose` is of a kind calls that code (Rule 2), as a call
 * would. Only the value's own kind is judged, what its fields hold having been made already, so a
 * literal reads no layout of what it holds (a field's type taken from its default may hold it).
 */
export function checkMadeKind(context: BodyContext, at: AnchoredSpan, type: Type): void {
  const frame = context.functions.current;
  const kind = ownValueKindOf(context.checker, type);
  if (kind === undefined) {
    return;
  }
  frame.relyOnKind();
  if (sameType(kind, frame.codeKind)) {
    return;
  }
  const { codeKind } = frame;
  context.report(
    codeKind.kind === 'literal'
      ? checkerDiagnostics.kindsHeld(at, callerName(frame), kindText(codeKind), typeText(type))
      : checkerDiagnostics.unmarkedHolds(at, callerName(frame), kindText(kind), typeText(type)),
  );
}

/** How a message names a kind: `live`, `ista`, or the variable or union it is. */
export function kindText(kind: Type): string {
  return kind.kind === 'literal' ? String(kind.value) : typeText(kind);
}

/** How a message names the function `frame` checks. */
export function callerName(frame: FunctionFrame): string {
  const own = frame.function;
  if (own === undefined) {
    return 'this code';
  }
  return own.kind === 'Lambda'
    ? 'a lambda'
    : `'${declaredFunctionName(own as FunctionDeclaration)}'`;
}
