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
 * - A lambda or a local `fn` given no mark infers it from its body: calling a function of a kind,
 *   or handling a value of one, a call's type arguments' among them, makes it rely on its code's.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import { declaredFunctionName } from '../../../syntax/declarations/field-defaults.ts';
import { typeParametersOf } from '../../../syntax/declarations/index.ts';
import { deferredCallOf } from '../../../syntax/expressions/deferred-functions.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { BodyContext, FunctionFrame } from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { UseSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { NestedFunction } from '../../surface/checked-body.ts';
import {
  callsMadeWith,
  type FunctionCall,
  instantiatingTypesOf,
  type ResolvedCall,
} from '../../surface/resolved-call.ts';
import { sameType } from '../../types/identity/identity.ts';
import { type Substitution, substitute, substitutionFor } from '../../types/parts/substitution.ts';
import {
  isSimpleMark,
  kindAdmits,
  kindOfFunction,
  simpleMark,
} from '../../types/type/function-kinds.ts';
import type { Type } from '../../types/type/index.ts';
import { markOrder } from '../../types/type/mark-orders.ts';
import { typeText } from '../../types/type/type-text.ts';
import { callMade } from '../choosing/calls-made.ts';
import type { Application } from '../choosing/choice.ts';

/**
 * The kind of the function `call` calls, as the call instantiates it: a requirement's through its
 * trait's `Self` and type parameters too.
 */
function kindOfCall(checker: CheckerContext, call: ResolvedCall): Type {
  const kind = kindOfFunction(checker, call.function);
  // Most marks are written, `"simple"` most of all, naming no type parameter to instantiate.
  if (kind.kind === 'literal') {
    return kind;
  }
  const own = substitutionFor(typeParametersOf(call.function.typeParameters), call.typeArguments);
  const through: Substitution =
    call.kind === 'requirement' ? new Map([...call.substitution, ...own]) : own;
  return substitute(kind, through, checker.typeRules);
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
  for (const each of callsMadeWith(call)) {
    checkCallKind(context, {
      at: made.at,
      frame: made.frame,
      calleeKind: kindOfCall(context.checker, each),
      callee: `'${declaredFunctionName(each.function)}'`,
    });
    for (const type of instantiatingTypesOf(each)) {
      handledBy(context.checker, made.frame, type);
    }
  }
  return call;
}

/**
 * The least mark, from `start` up, of a function that makes `call` when called (proposal 8, Rules
 * 2–3): one allowing every call it makes and the values their type arguments hand it. A part of
 * the other kind is reported through `report`, `holder` naming the function, no mark allowing both.
 */
export function markMaking(
  checker: CheckerContext,
  made: {
    readonly call: ResolvedCall;
    readonly holder: string;
    readonly report: UseSite['report'];
  },
  start: Type,
): Type {
  let least = start;
  const allow = (
    kind: Type,
    refusal: (at: AnchoredSpan, mark: string) => Diagnostic<AnchoredSpan>,
  ) => {
    const joined = markOrder.join([least, kind], sameType);
    if (joined === undefined) {
      const refused = kindText(least);
      made.report((at) => refusal(at, refused));
    } else {
      least = joined;
    }
  };
  for (const each of callsMadeWith(made.call)) {
    const calleeKind = kindOfCall(checker, each);
    const callee = `'${declaredFunctionName(each.function)}'`;
    allow(calleeKind, (at, mark) =>
      checkerDiagnostics.kindsMeet(at, mark, kindText(calleeKind), callee),
    );
    for (const type of instantiatingTypesOf(each)) {
      for (const kind of checker.valueKindsOf(type)) {
        allow(kind, (at, mark) =>
          checkerDiagnostics.kindsHeld(at, made.holder, mark, typeText(type)),
        );
      }
    }
  }
  return least;
}

/**
 * The least mark of code making `call` (`markMaking`), from simple up; undefined where none allows
 * every call it makes and every value they hand it, both kinds meeting in them.
 */
export function leastMarkMaking(checker: CheckerContext, call: ResolvedCall): Type | undefined {
  let allowed = true;
  const refused = () => {
    allowed = false;
  };
  const least = markMaking(checker, { call, holder: '', report: refused }, simpleMark);
  return allowed ? least : undefined;
}

/**
 * Notes that `frame` handles a value of `type`, which it gives back: a nested function given no mark
 * infers it from what its body handles (proposal 8, Rule 2), the data rule's sites
 * (rules/kinds/data-kinds.ts). A body's own function infers nothing, so its kinds aren't asked.
 */
export function handledBy(checker: CheckerContext, frame: FunctionFrame, type: Type): Type {
  if (frame.reach !== undefined && !frame.reliesOnKind && checker.valueKindsOf(type).length > 0) {
    frame.relyOnKind();
  }
  return type;
}

/** A call to judge: where it is, the function whose code makes it, what it calls and its kind. */
interface CallOfKind {
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
  if (!isSimpleMark(calleeKind)) {
    frame.relyOnKind();
  }
  if (kindAdmits(caller, calleeKind, sameType)) {
    return;
  }
  // The function a deferred call gives has no head to declare its mark in.
  context.report(
    isSimpleMark(caller) && frame.makesLater === undefined
      ? checkerDiagnostics.unmarkedCalls(at, callerName(frame), kindText(calleeKind), callee)
      : checkerDiagnostics.kindsMeet(at, kindText(caller), kindText(calleeKind), callee),
  );
}

/** How a message names a kind: `live`, `ista`, or the variable or union it is. */
export function kindText(kind: Type): string {
  return kind.kind === 'literal' ? String(kind.value) : typeText(kind);
}

/** How a message names the function `frame` checks. */
export function callerName(frame: FunctionFrame): string {
  return frame.function === undefined ? 'this code' : functionName(frame.function);
}

/** How a message names a nested function: a lambda, the function a deferred call gives, or by name. */
export function functionName(node: NestedFunction): string {
  if (node.kind === 'FunctionDeclaration') {
    return `'${declaredFunctionName(node)}'`;
  }
  return deferredCallOf(node) === undefined ? 'a lambda' : 'a deferred call';
}
