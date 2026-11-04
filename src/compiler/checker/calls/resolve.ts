/**
 * Resolving a call in a body (§3.3, §3.7, §3.9): applied as every call is (resolution/applied-call.ts),
 * chosen, instantiated with its constraints met and its arguments fitted, so their implicit
 * conversions are too, then recorded for lowering with what only a written call has: its receiver,
 * the places it changes, and a report about a call nothing takes.
 *
 * - An argument whose type the chosen function decides (`none`, a bare variant, a lambda with an
 *   untyped parameter, an empty `[]`, a literal holding one) is checked only after choosing,
 *   against its parameter's type; a lambda, before instantiating, so its result can bind type
 *   parameters (lambda-arguments.ts).
 * - A method call records its receiver with the call, as lowering passes it first (§3.7). A
 *   receiver the chosen function's `self` takes by reference must be a place that may change.
 * - An argument of the error type was already reported, so the call reports nothing more.
 * - A failure is explained as precisely as the candidates allow: with one candidate, what exactly
 *   doesn't fit it, as choosing decided it, so an explanation never disagrees with the choice.
 * - Calling `dispose` directly is refused, since the runtime calls it once nothing holds a value
 *   (§7). The rules every call obeys, witnesses of constraints included, apply where the call is
 *   made (resolution/calls-made.ts).
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { primitiveOnceSpelled } from '../../../language/primitives.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { Accepts, BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { applyCall } from '../resolution/applied-call.ts';
import { argumentListText } from '../resolution/argument-fit.ts';
import { argumentSlotsOf, type BindingFailure } from '../resolution/binding.ts';
import type { CallArgument, Inapplicability, Passing } from '../resolution/call-arguments.ts';
import { callMade } from '../resolution/calls-made.ts';
import type { Candidate } from '../resolution/candidates.ts';
import type { Application } from '../resolution/choice.ts';
import type { Instantiation } from '../resolution/conformance.ts';
import type { ResolvedSite } from '../resolved-call.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { checkDecidedLambdas } from './lambda-arguments.ts';
import { changeReceiver, checkReferencedPlaces } from './places.ts';

/**
 * An argument as written: its node, how it is passed, and its type, undefined when the chosen
 * function decides it, with which parameter types it can take (resolution/choice.ts); its name
 * when named. A spread's node is what it spreads, its type that of its items, which fit the rest
 * parameter's element exactly: the items are copied or iterated as they are (§3.3).
 */
export interface WrittenArgument {
  readonly node: Expression;
  readonly passing: Passing;
  readonly type: Type | undefined;
  readonly accepts?: Accepts | undefined;
  readonly name?: Identifier | undefined;
  readonly isSpread?: boolean | undefined;
}

/** A call to resolve, as written. */
export interface CallRequest {
  readonly site: ResolvedSite;
  /** The function's name, or the operator, as messages name the call. */
  readonly name: string;
  readonly candidates: readonly Candidate[];
  readonly arguments: readonly WrittenArgument[];
  readonly typeArguments: readonly Type[] | undefined;
  readonly expected: Type | undefined;
  /** How a call no candidate takes reads: as a call, or as an operator on its operands. */
  readonly form: 'call' | 'operator';
  /** A method call's receiver, its first argument (§3.7). */
  readonly receiver?: Expression;
  /** What to report instead when no candidate takes the arguments, if anything. */
  readonly hint?: () => Diagnostic<AnchoredSpan> | undefined;
}

/** Resolves `request`, recording the call; what it yields, or the error type after a report. */
export function resolveCall(context: BodyContext, request: CallRequest): Type {
  const { site, receiver } = request;
  context.recordCandidates(
    site,
    request.candidates.map(({ declaration }) => declaration),
  );
  const written = request.arguments;
  const applied = applyCall(context, {
    span: site.span,
    name: request.name,
    candidates: request.candidates,
    arguments: written.map((argument) => ({ ...callArgumentOf(argument), node: argument.node })),
    typeArguments: request.typeArguments,
    expected: request.expected,
    none: (reasons) => {
      const hint = request.hint?.();
      if (hint === undefined) {
        explainNone(context, request, reasons);
      } else {
        context.report(hint);
      }
    },
    chosen: (chosen) => checkDecidedLambdas(context, written, chosen),
  });
  if (applied === undefined) {
    return errorType;
  }
  const { application, instantiation } = applied;
  const { signature } = application;
  recordChosen(context, { site, application, instantiation, receiver });
  if (receiver !== undefined && signature.parameters[0]?.reference === true) {
    changeReceiver(context, receiver);
  }
  const slots = argumentSlotsOf(signature.parameters, application.binding);
  checkReferencedPlaces(context, written, {
    name: request.name,
    isAsync: signature.declaration.isAsync,
    slots: written.map((_, index) => slots.get(index) ?? { reference: false }),
  });
  return applied.result;
}

/** A written argument as choosing sees it. */
export function callArgumentOf(argument: WrittenArgument): CallArgument {
  const { type, passing, accepts, name, isSpread } = argument;
  return { type, passing, accepts, name: name?.text, isSpread, exact: isSpread === true };
}

/** A chosen function, instantiated, at the site calling it or naming it as a value. */
export interface Chosen {
  readonly site: ResolvedSite;
  readonly application: Application;
  readonly instantiation: Instantiation;
  readonly receiver?: Expression | undefined;
}

/**
 * Records the call `chosen` makes. That it may make it at all, since only the runtime calls a
 * `dispose` (§7), is checked once the body is (rules/disposal.ts).
 */
export function recordChosen(context: BodyContext, chosen: Chosen): void {
  const { site, application, instantiation, receiver } = chosen;
  const call = callMade(application, instantiation);
  context.recordCall(site, receiver === undefined ? call : { ...call, receiver });
}

/** The report saying why a call's arguments can't fill its one function's parameters (§3.3). */
function bindingReport(request: ExplainedCall, reason: BindingFailure): Diagnostic<AnchoredSpan> {
  const { site, name } = request;
  switch (reason.kind) {
    case 'arity': {
      const count = request.arguments.length;
      const expected = count > reason.maximum ? reason.maximum : reason.minimum;
      const atLeast = reason.maximum === Number.POSITIVE_INFINITY;
      return checkerDiagnostics.argumentCount(site.span, name, expected, count, atLeast);
    }
    case 'unnamed':
      return checkerDiagnostics.noParameterNamed(namedAt(request, reason.name), name, reason.name);
    case 'twice':
      return checkerDiagnostics.givenTwice(namedAt(request, reason.name), reason.name);
    case 'missing':
      return checkerDiagnostics.missingArgument(site.span, name, reason.name);
    case 'spread': {
      const spread = request.arguments.find((argument) => argument.isSpread === true);
      return checkerDiagnostics.spreadWithoutRest(spread?.node.span ?? site.span, name);
    }
    case 'packNamed':
      return checkerDiagnostics.packNamed(namedAt(request, reason.name), reason.name);
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

/** The report saying why a pack's arguments, or a written pack, don't fill it (§3.5). */
function packReport(
  request: ExplainedCall,
  reason: Extract<Inapplicability, { kind: 'pack' | 'packTypeArgument' }>,
): Diagnostic<AnchoredSpan> {
  const { site } = request;
  if (reason.kind === 'packTypeArgument') {
    const { parameter, type } = reason;
    return checkerDiagnostics.packTypeArgument(site.span, parameter.name.text, typeText(type));
  }
  const at = request.arguments[reason.index]?.node.span ?? site.span;
  const { expected, found } = reason;
  return found === undefined
    ? checkerDiagnostics.packArguments(at, typeText(expected))
    : checkerDiagnostics.packMismatch(at, typeText(expected), typeText(found));
}

/** Where the argument named `name` is written; the call, if none is. */
function namedAt(request: ExplainedCall, name: string): AnchoredSpan {
  const named = request.arguments.findLast((argument) => argument.name?.text === name);
  return named?.name?.span ?? request.site.span;
}

function explainNone(
  context: BodyContext,
  request: CallRequest,
  reasons: readonly Inapplicability[],
): void {
  const { site, name, candidates } = request;
  const [reason] = reasons;
  if (candidates.length === 1 && reasons.length === 1 && reason !== undefined) {
    explain(context, request, reason);
  } else if (candidates.length === 0 && request.form === 'call') {
    const primitive = primitiveOnceSpelled(name);
    context.report(
      primitive === undefined
        ? checkerDiagnostics.noFunctionNamed(site.span, name)
        : checkerDiagnostics.lowercaseConversion(site.span, name, primitive),
    );
  } else if (request.form === 'operator') {
    context.report(
      checkerDiagnostics.operatorTypes(
        site.span,
        name,
        request.arguments.map(({ type }) => (type === undefined ? '_' : typeText(type))),
      ),
    );
  } else {
    context.report(
      checkerDiagnostics.noMatchingOverload(site.span, name, argumentListText(request.arguments)),
    );
  }
}

/** A call as a report about it reads it: where, of what name, with what written. */
export type ExplainedCall = Pick<CallRequest, 'site' | 'name' | 'arguments' | 'typeArguments'>;

/**
 * With one function, the report says what exactly doesn't fit: the `reason` it was refused for.
 * An argument the chosen function would have decided is checked against the type it didn't take,
 * which says why.
 */
export function explain(
  context: BodyContext,
  request: ExplainedCall,
  reason: Inapplicability,
): void {
  const { site, name } = request;
  switch (reason.kind) {
    case 'arity':
    case 'unnamed':
    case 'twice':
    case 'missing':
    case 'spread':
    case 'packNamed':
      context.report(bindingReport(request, reason));
      return;
    case 'pack':
    case 'packTypeArgument':
      context.report(packReport(request, reason));
      return;
    case 'typeArgumentCount': {
      const count = request.typeArguments?.length ?? 0;
      const expected = count > reason.maximum ? reason.maximum : reason.minimum;
      context.report(checkerDiagnostics.typeArgumentCount(site.span, name, expected, count));
      return;
    }
    case 'reference': {
      const at = request.arguments[reason.index]?.node.span ?? site.span;
      context.report(checkerDiagnostics.passing(at, name, reason.index + 1, reason.reference));
      return;
    }
    case 'conflict':
      context.report(checkerDiagnostics.cannotInfer(site.span, name, reason.parameter.name.text));
      return;
    case 'arguments': {
      const before = context.checker.reportCount();
      for (const { index, expected } of reason.misfits) {
        const argument = request.arguments[index];
        if (argument?.type !== undefined) {
          const { node, type } = argument;
          context.report(
            checkerDiagnostics.typeMismatch(node.span, typeText(expected), typeText(type)),
          );
        } else if (argument !== undefined) {
          context.expect(argument.node, expected);
        }
      }
      if (context.checker.reportCount() === before) {
        context.report(
          checkerDiagnostics.noMatchingOverload(
            site.span,
            name,
            argumentListText(request.arguments),
          ),
        );
      }
      return;
    }
    default: {
      const unexplained: never = reason;
      unreachable(`No explanation for ${JSON.stringify(unexplained)}.`);
    }
  }
}
