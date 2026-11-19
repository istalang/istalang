/**
 * Resolving a call in a body (§6.1, §6.2, §10.2): applied as every call is
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
 * - A method call records its receiver with the call, as lowering passes it first (§6.2). A
 *   receiver the chosen function's `self` takes by reference must be a place that may change.
 * - An argument of the error type was already reported, so the call reports nothing more.
 * - A failure is explained as precisely as the candidates allow (explanations.ts); a call still
 *   being written records what each argument written so far is expected to be, for tools
 *   (written-expectations.ts).
 * - Calling `dispose` directly is refused, since the runtime calls it once nothing holds a value
 *   (§16). The rules every call obeys, witnesses of constraints included, apply where the call is
 *   made (resolution/choosing/calls-made.ts).
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { bodySite } from '../../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import type { ResolvedSite } from '../../../surface/resolved-call.ts';
import type { Inference } from '../../../types/inference/infer.ts';
import { mentionsOnlyPlaceholders } from '../../../types/inference/variables.ts';
import type { LiteralType, Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { type CallApplication, chooseCall, completeCall } from '../../applying/applied-call.ts';
import { withSolvedTypes } from '../../applying/argument-fit.ts';
import { judgedCall } from '../../applying/call-kinds.ts';
import type { CallArgument, Passing } from '../../choosing/call-arguments.ts';
import type { Candidate } from '../../choosing/candidates.ts';
import type { Application } from '../../choosing/choice.ts';
import { type Instantiation, settlingAt } from '../../conformance/conformance.ts';
import { changeReceiver, checkReferencedPlaces } from '../places.ts';
import { explainNone } from './explanations.ts';
import { expectWrittenArguments } from './written-expectations.ts';

/**
 * An argument as written: its node, how it is passed, and its type, a placeholder of the call's
 * constraint scope where the scope checks it once it knows what the call expects of it
 * (wiring/body/constraint-scope.ts); its name when named. A spread's node is what it spreads, its
 * type that of its items, which fit the rest parameter's element exactly: the items are copied or
 * iterated as they are (§6.1). The function a call gives after its arguments (`Call.given`, §6.5)
 * is one the binding places itself.
 */
export interface WrittenArgument {
  readonly node: Expression;
  readonly passing: Passing;
  readonly type: Type | undefined;
  readonly literal?: LiteralType | undefined;
  readonly name?: Identifier | undefined;
  readonly isSpread?: boolean | undefined;
  /** Whether it is the function the call gives after its arguments (§6.5, choosing/binding.ts). */
  readonly isDeferred?: boolean | undefined;
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
  /** A method call's receiver, its first argument (§6.2). */
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
  context.calls.recordCandidates(
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
  const settling = settlingAt(bodySite(context, site.span), chosen.signature);
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
    arguments: written.map(appliedArgumentOf),
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
    // A function giving a future may run on past its call: it is async (§6.4).
    isAsync: context.checker.fitting.awaitedOf(signature.result())?.value !== undefined,
    slots: written.map((_, index) => slots.get(index) ?? { reference: false }),
  });
  return applied.result;
}

/** A written argument as choosing sees it. */
export function callArgumentOf(argument: WrittenArgument): CallArgument {
  const { type, literal, passing, name, isSpread, isDeferred } = argument;
  return {
    type,
    literal,
    passing,
    name: name?.text,
    isSpread,
    isDeferred,
    exact: isSpread === true,
  };
}

/** A written argument as applying sees it: as choosing does, at its node. */
export function appliedArgumentOf(
  argument: WrittenArgument,
): CallArgument & { readonly node: Expression } {
  return { ...callArgumentOf(argument), node: argument.node };
}

/** A chosen function, instantiated, at the site calling it. */
interface Chosen {
  readonly site: ResolvedSite;
  readonly application: Application;
  readonly instantiation: Instantiation;
  readonly receiver?: Expression | undefined;
}

/**
 * Records the call `chosen` makes, where its code's kind lets it make it (§9.1), the code being
 * the function checked, which settling a scope runs in again (wiring/body/body-scopes.ts). That it
 * may make it at all, since only the runtime calls a `dispose` (§16), is checked once the body is
 * (rules/disposal/disposal.ts).
 */
function recordChosen(context: BodyContext, chosen: Chosen): void {
  const { site, application, instantiation, receiver } = chosen;
  const frame = context.functions.current;
  const call = judgedCall(context, { at: site.span, frame, application, instantiation });
  context.calls.record(site, receiver === undefined ? call : { ...call, receiver });
}
