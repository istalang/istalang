/**
 * Resolving a call in a body (§3.3, §3.7, §3.9): applied as every call is
 * (resolution/applying/applied-call.ts), chosen, instantiated with its constraints met and its
 * arguments fitted, so their implicit conversions are too, then recorded for lowering with what
 * only a written call has: its receiver, the places it changes, and a report about a call nothing
 * takes. Choosing comes first; the rest waits for the constraint scope the call stands in to settle
 * (wiring/body/constraint-scope.ts), and so does reporting a call no candidate takes while what it is
 * given is still open there, which then reads its arguments as they settled.
 *
 * - An argument whose type the chosen function decides (a bare variant, a lambda with an untyped
 *   parameter, an empty `[]`, a literal holding one) is a placeholder of the scope, judged once
 *   what its parameter expects of it is known, so its result bounds type parameters
 *   (constructs/expressions/postponed.ts).
 * - A method call records its receiver with the call, as lowering passes it first (§3.7). A
 *   receiver the chosen function's `self` takes by reference must be a place that may change.
 * - An argument of the error type was already reported, so the call reports nothing more.
 * - A failure is explained as precisely as the candidates allow: with one candidate, what exactly
 *   doesn't fit it, as choosing decided it, so an explanation never disagrees with the choice.
 * - Calling `dispose` directly is refused, since the runtime calls it once nothing holds a value
 *   (§7). The rules every call obeys, witnesses of constraints included, apply where the call is
 *   made (resolution/choosing/calls-made.ts).
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import { primitiveOnceSpelled } from '../../../../foundation/language/primitives.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { useSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { ResolvedSite } from '../../surface/resolved-call.ts';
import { misfitOf } from '../../types/fitting/fit/index.ts';
import type { Inference } from '../../types/inference/infer.ts';
import { isPlaceholder, mentionsOnlyPlaceholders } from '../../types/inference/variables.ts';
import type { LiteralType, Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { type CallApplication, chooseCall, completeCall } from '../applying/applied-call.ts';
import { argumentListText, withSolvedTypes } from '../applying/argument-fit.ts';
import type { BindingFailure } from '../choosing/binding.ts';
import type { CallArgument, Inapplicability, Misfit, Passing } from '../choosing/call-arguments.ts';
import { callMade } from '../choosing/calls-made.ts';
import type { Candidate } from '../choosing/candidates.ts';
import type { Application } from '../choosing/choice.ts';
import { type Instantiation, settlingAt } from '../conformance/conformance.ts';
import { changeReceiver, checkReferencedPlaces } from './places.ts';
import { expectWrittenArguments } from './written-expectations.ts';

/**
 * An argument as written: its node, how it is passed, and its type, a placeholder of the call's
 * constraint scope where the scope checks it once it knows what the call expects of it
 * (wiring/body/constraint-scope.ts); its name when named. A spread's node is what it spreads, its type that of its items, which fit the rest
 * parameter's element exactly: the items are copied or iterated as they are (§3.3).
 */
export interface WrittenArgument {
  readonly node: Expression;
  readonly passing: Passing;
  readonly type: Type | undefined;
  readonly literal?: LiteralType | undefined;
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
  /**
   * The expression the call is, which its constraint scope records once it settles: a written
   * call's; none for an operator's or an index's, whose own handler records it.
   */
  readonly recorded?: Expression | undefined;
}

/**
 * Resolves `request`, joining the current constraint scope (wiring/body/constraint-scope.ts), which
 * records the call once it settles: what it yields, open until then, or the error type after a
 * report.
 */
export function resolveCall(context: BodyContext, request: CallRequest): Type {
  const { site } = request;
  context.recordCandidates(
    site,
    request.candidates.map(({ declaration }) => declaration),
  );
  const scope = context.scopes.root;
  // An argument the scope still infers into is reported once it settles; a placeholder alone, which
  // reads as `_`, at once, as an argument the call decides always was.
  const openArguments = request.arguments.some(
    ({ type }) =>
      type !== undefined && context.scopes.holds(type) && !mentionsOnlyPlaceholders(type),
  );
  const meetsScope =
    request.arguments.some(({ type }) => context.scopes.holds(type)) ||
    context.scopes.holds(request.expected);
  // A candidate meets the scope's variables only through what it is given or expected to give;
  // where neither holds one, its system starts empty, and committing it adds its own.
  const { applying, chosen } = chosenCall(context, request, {
    scope: meetsScope ? scope : undefined,
    openArguments,
  });
  if (chosen === undefined) {
    if (openArguments) {
      reportUnmade(context, request);
    } else {
      context.scopes.abandon(request.arguments.map(({ type }) => type));
      expectWrittenArguments(context, applying);
    }
    return errorType;
  }
  const { checker } = context;
  const settling = settlingAt(useSite(checker, context.module, site.span), chosen.signature);
  return context.scopes.join({
    node: request.recorded,
    inference: chosen.inference,
    type: chosen.inference.open(chosen.signature.result()),
    settling,
    complete: () => completeResolved(context, request, applying, chosen),
  });
}

/**
 * How `request` is applied, its candidates' systems copies of `scope`'s, and the one it chooses:
 * among them as what it is given stands; where that is open in the scope and none takes it so,
 * again once what only a default decides of it is fixed to that default (`Scopes.fixDefaults`),
 * as it will settle, so it doesn't fail here where it would choose once the scope settles.
 */
function chosenCall(
  context: BodyContext,
  request: CallRequest,
  {
    scope,
    openArguments,
  }: { readonly scope: Inference | undefined; readonly openArguments: boolean },
): { readonly applying: CallApplication; readonly chosen: Application | undefined } {
  const applying = applicationOf(context, request, scope);
  const chosen = chooseCall(context, applying, { reports: !openArguments });
  const types = request.arguments.map(({ type }) => type);
  if (chosen !== undefined || !openArguments || !context.scopes.fixDefaults(types)) {
    return { applying, chosen };
  }
  const retried = applicationOf(context, request, context.scopes.root);
  return { applying: retried, chosen: chooseCall(context, retried, { reports: false }) };
}

/** How `request` is applied, its candidates' systems copies of `scope`'s, if one is open. */
function applicationOf(
  context: BodyContext,
  request: CallRequest,
  scope: Inference | undefined,
): CallApplication {
  const { site } = request;
  const written = request.arguments;
  return {
    span: site.span,
    site,
    name: request.name,
    candidates: request.candidates,
    arguments: written.map((argument) => ({ ...callArgumentOf(argument), node: argument.node })),
    typeArguments: request.typeArguments,
    expected: request.expected,
    scope,
    none: (reasons) => {
      const hint = request.hint?.();
      if (hint === undefined) {
        explainNone(context, request, reasons);
      } else {
        context.report(hint);
      }
    },
  };
}

/**
 * A call no candidate takes, whose arguments' types are still open in its constraint scope: what
 * they would have bounded gets the error type, and once the scope is solved the call is chosen
 * again among its candidates with their types solved, which reports why none takes them as their
 * own types read. One a candidate takes then is reported all the same: what the scope settled read
 * it as no call, its value the error type, so it can't be made as it settled (5380).
 */
function reportUnmade(context: BodyContext, request: CallRequest): void {
  context.scopes.abandon(request.arguments.map(({ type }) => type));
  context.scopes.whenSolved((solved) => {
    const settled = { ...request, arguments: withSolvedTypes(request.arguments, solved) };
    const applying = applicationOf(context, settled, undefined);
    if (chooseCall(context, applying) === undefined) {
      expectWrittenArguments(context, applying);
    } else {
      context.report(checkerDiagnostics.undecidedCall(request.site.span, request.name));
    }
  });
}

/** Completes the call `request` makes, once its system is settled, recording it; its type. */
function completeResolved(
  context: BodyContext,
  request: CallRequest,
  applying: CallApplication,
  chosen: Application,
): Type {
  const applied = completeCall(context, applying, chosen);
  if (applied === undefined) {
    return errorType;
  }
  const { site, receiver } = request;
  const { signature, slots } = applied.application;
  recordChosen(context, {
    site,
    application: applied.application,
    instantiation: applied.instantiation,
    receiver,
  });
  if (receiver !== undefined && signature.parameters[0]?.reference === true) {
    changeReceiver(context, receiver);
  }
  const written = request.arguments;
  checkReferencedPlaces(context, written, {
    name: request.name,
    // A function giving a future may run on past its call: it is async (§3.14).
    isAsync: context.checker.fitting.futureValue(signature.result()) !== undefined,
    slots: written.map((_, index) => slots.get(index) ?? { reference: false }),
  });
  return applied.result;
}

/** A written argument as choosing sees it. */
export function callArgumentOf(argument: WrittenArgument): CallArgument {
  const { type, literal, passing, name, isSpread } = argument;
  return { type, literal, passing, name: name?.text, isSpread, exact: isSpread === true };
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
 * `dispose` (§7), is checked once the body is (rules/disposal/disposal.ts).
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
    const list = argumentListText(request.arguments);
    const [first] = request.arguments;
    const onUnion = first?.type?.kind === 'union';
    context.report(checkerDiagnostics.noMatchingOverload(site.span, name, list, onUnion));
  }
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
    if (argument?.type !== undefined && !isPlaceholder(argument.type)) {
      const { node, type } = argument;
      context.report(misfitOf(context.checker.fitting, node.span, type, expected));
    } else if (argument !== undefined) {
      // Checked on its own, as nothing the scope holds tells it what to be.
      context.expectSettled(argument.node, expected);
    }
  }
  if (context.checker.reportCount() === before) {
    const list = argumentListText(request.arguments);
    context.report(checkerDiagnostics.noMatchingOverload(request.site.span, request.name, list));
  }
}

/** The report that an argument gave a member parameter several members of its union (§3.5). */
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

/** A call as a report about it reads it: where, of what name, with what written. */
export type ExplainedCall = Pick<CallRequest, 'site' | 'name' | 'arguments' | 'typeArguments'>;

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
