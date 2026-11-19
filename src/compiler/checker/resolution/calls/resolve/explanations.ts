/**
 * Why a call no candidate takes isn't made, as precisely as its candidates allow: with one
 * candidate, what exactly doesn't fit it, as choosing decided it, so an explanation never disagrees
 * with the choice; a call to run later that no candidate can take, that alone (§6.5); else no
 * overload taking what it was given.
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import { primitiveOnceSpelled } from '../../../../../foundation/language/primitives.ts';
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import { calledName } from '../../../../syntax/expressions/readings.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import {
  type FunctionNaming,
  isCalling,
  type ResolvedSite,
} from '../../../surface/resolved-call.ts';
import { misfitOf } from '../../../types/fitting/fit/index.ts';
import { isPlaceholder } from '../../../types/inference/variables.ts';
import type { Type } from '../../../types/type/index.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { argumentListText } from '../../applying/argument-fit.ts';
import type { BindingFailure } from '../../choosing/binding.ts';
import type { Inapplicability, Misfit } from '../../choosing/call-arguments.ts';
import { explainedCaptures } from '../captured-sends.ts';
import type { CallRequest, WrittenArgument } from './index.ts';

/**
 * With one function, the report says what exactly doesn't fit: the `reason` it was refused for.
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
    case 'takesNoCall':
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
    case 'severalMembers':
      context.report(severalMembersReport(context, request, reason));
      return;
    case 'arguments':
      explainMisfits(context, request, reason.misfits);
      return;
    default: {
      const unexplained: never = reason;
      unreachable(`No explanation for ${JSON.stringify(unexplained)}.`);
    }
  }
}

export function explainNone(
  context: BodyContext,
  request: CallRequest,
  reasons: readonly Inapplicability[],
): void {
  const { site, name, candidates } = request;
  const [reason] = reasons;
  // A call to run later that no candidate can take is that, whatever else each refuses.
  const takesNoCall = reasons.length > 0 && reasons.every(({ kind }) => kind === 'takesNoCall');
  if ((candidates.length === 1 && reasons.length === 1) || takesNoCall) {
    if (reason !== undefined) {
      explain(context, request, reason);
    }
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
    const list = argumentListText(request.arguments);
    const [first] = request.arguments;
    const onUnion = first?.type?.kind === 'union';
    context.report(checkerDiagnostics.noMatchingOverload(site.span, name, list, onUnion));
  }
}

/** A call as a report about it reads it: where, of what name, with what written. */
/** A call explained, or a naming of a function as a value, which no function taking none fits. */
type ExplainedCall = Pick<CallRequest, 'name' | 'arguments' | 'typeArguments'> & {
  readonly site: ResolvedSite | FunctionNaming;
};

/** The report saying why a call's arguments can't fill its one function's parameters (§6.1). */
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
    case 'takesNoCall':
      return checkerDiagnostics.takesNoCall(takerAt(request), name);
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

/** The report saying why a pack's arguments, or a written pack, don't fill it (§8.1). */
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

/** Where the function a call gives after its arguments is given to is named: its callee's name. */
function takerAt({ site }: ExplainedCall): AnchoredSpan {
  return isCalling(site) && site.given !== undefined ? calledName(site).span : site.span;
}

/** Where the argument named `name` is written; the call, if none is. */
function namedAt(request: ExplainedCall, name: string): AnchoredSpan {
  const named = request.arguments.findLast((argument) => argument.name?.text === name);
  return named?.name?.span ?? request.site.span;
}

/**
 * Each argument that doesn't fit its parameter, reported as a mismatch; one its scope would have
 * checked once it knew what the call expects of it, a placeholder (wiring/body/constraint-scope.ts),
 * is checked against the type it didn't take, which says why. With
 * nothing reported that way, no function of the name takes the arguments.
 */
function explainMisfits(
  context: BodyContext,
  request: ExplainedCall,
  misfits: readonly Misfit[],
): void {
  const before = context.checker.reportCount();
  for (const { index, expected } of misfits) {
    const argument = request.arguments[index];
    if (argument !== undefined) {
      explainMisfit(context, argument, expected);
    }
  }
  if (context.checker.reportCount() === before) {
    const list = argumentListText(request.arguments);
    context.report(checkerDiagnostics.noMatchingOverload(request.site.span, request.name, list));
  }
}

/**
 * Why `argument` doesn't fit where `expected` is: a closure by what it captures, where that is why
 * (§6.4); else as its type misfits.
 */
function explainMisfit(context: BodyContext, argument: WrittenArgument, expected: Type): void {
  const { type, node } = argument;
  if (explainedCaptures(context, node, expected)) {
    return;
  }
  if (type !== undefined && !isPlaceholder(type)) {
    context.report(misfitOf(context.checker.fitting, node.span, type, expected));
  } else {
    // Checked on its own, as nothing the scope holds tells it what to be.
    context.expectSettled(node, expected);
  }
}

/** The report that an argument gave a member parameter several members of its union (§8.1). */
function severalMembersReport(
  context: BodyContext,
  request: ExplainedCall,
  { index, parameter, found }: Extract<Inapplicability, { kind: 'severalMembers' }>,
): Diagnostic<AnchoredSpan> {
  const at = request.arguments[index]?.node.span ?? request.site.span;
  const union = context.checker.memberUnionOf(parameter);
  return checkerDiagnostics.severalMembersArgument(
    at,
    parameter.name.text,
    union === undefined ? '_' : typeText(union),
    typeText(found),
  );
}
