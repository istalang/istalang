/**
 * Resolving a call in a body (§3.3, §3.7, §3.9): its arguments choose among the candidates
 * (choice.ts), the choice is instantiated with its constraints met (traits/conformance.ts), and
 * the call is recorded for lowering with its arguments fitted, so their implicit wraps are too.
 *
 * - An argument whose type the chosen function decides (`none`, a bare variant) is checked only
 *   after choosing, against its parameter's type.
 * - An argument of the error type was already reported, so the call reports nothing more.
 * - A failure is explained as precisely as the candidates allow: with one candidate, what exactly
 *   doesn't fit it.
 * - Calling `dispose` directly is refused, since the runtime calls it once nothing holds a value
 *   (§7). The rules every call obeys, witnesses of constraints included, apply where the call is
 *   made (calls-made.ts).
 */

import { disposeFunction } from '../../../language/well-known.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { CallSite } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { instantiate } from '../traits/conformance.ts';
import { errorType, substitute, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { useSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import type { Candidate } from './candidates.ts';
import { type Application, choose, type Inapplicability } from './choice.ts';

/**
 * An argument as written: its node, and its type, undefined when the chosen function decides it,
 * with which parameter types it can take (choice.ts).
 */
export interface WrittenArgument {
  readonly node: Expression;
  readonly type: Type | undefined;
  readonly accepts?: ((expected: Type) => boolean) | undefined;
}

/** A call to resolve, as written. */
export interface CallRequest {
  readonly site: CallSite;
  /** The function's name, or the operator, as messages name the call. */
  readonly name: string;
  readonly candidates: readonly Candidate[];
  readonly arguments: readonly WrittenArgument[];
  readonly typeArguments: readonly Type[] | undefined;
  readonly expected: Type | undefined;
  /** How a call no candidate takes reads: as a call, or as an operator on its operands. */
  readonly form: 'call' | 'operator';
}

/** Resolves `request`, recording the call; what it yields, or the error type after a report. */
export function resolveCall(context: BodyContext, request: CallRequest): Type {
  const written = request.arguments;
  if (written.some(({ type }) => type?.kind === 'error')) {
    return errorType;
  }
  const callArguments = written.map(({ type, accepts }) => ({ type, reference: false, accepts }));
  const choice = choose(context.checker, request.candidates, callArguments, request.typeArguments);
  switch (choice.kind) {
    case 'chosen':
      return complete(context, request, choice.application);
    case 'several':
      context.report(
        checkerDiagnostics.ambiguousCall(request.site.span, request.name, typesText(written)),
      );
      return errorType;
    case 'none':
      explainNone(context, request, choice.reasons);
      return errorType;
    default: {
      const unhandled: never = choice;
      return unhandled;
    }
  }
}

/** The types of written arguments, as a call's argument list reads: `int, string`. */
export function typesText(written: readonly WrittenArgument[]): string {
  return written.map(({ type }) => (type === undefined ? '_' : typeText(type))).join(', ');
}

function complete(context: BodyContext, request: CallRequest, application: Application): Type {
  const { site } = request;
  const instantiation = instantiate(
    useSite(context.checker, context.module, site.span),
    application,
    request.expected,
  );
  if (instantiation === undefined) {
    return errorType;
  }
  const { signature, candidate } = application;
  request.arguments.forEach(({ node, type }, index) => {
    const slot = signature.parameters[index];
    if (slot === undefined) {
      return;
    }
    const expected = substitute(slot.type, instantiation.substitution);
    context.fit(type ?? context.expression(node, expected), expected, node);
  });
  if (signature.declaration.name.text === disposeFunction) {
    context.report(checkerDiagnostics.disposeCall(site.span));
    return errorType;
  }
  const call = callMade(
    useSite(context.checker, context.module, site.span),
    candidate,
    instantiation,
    request.arguments.length,
  );
  if (call === undefined) {
    return errorType;
  }
  context.recordCall(site, call);
  return substitute(signature.result(), instantiation.substitution);
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
    context.report(checkerDiagnostics.noFunctionNamed(site.span, name));
  } else if (request.form === 'operator') {
    context.report(
      checkerDiagnostics.operatorTypes(
        site.span,
        name,
        request.arguments
          .map(({ type }) => (type === undefined ? '_' : typeText(type)))
          .join(' and '),
      ),
    );
  } else {
    context.report(
      checkerDiagnostics.noMatchingOverload(site.span, name, typesText(request.arguments)),
    );
  }
}

/**
 * With one candidate, the report says what exactly doesn't fit: the `reason` it was refused for.
 * An argument the chosen function would have decided is checked against the type it didn't take,
 * which says why.
 */
function explain(context: BodyContext, request: CallRequest, reason: Inapplicability): void {
  const { site, name } = request;
  switch (reason.kind) {
    case 'arity': {
      const count = request.arguments.length;
      const expected = count > reason.maximum ? reason.maximum : reason.minimum;
      context.report(checkerDiagnostics.argumentCount(site.span, name, expected, count));
      return;
    }
    case 'typeArgumentCount': {
      const count = request.typeArguments?.length ?? 0;
      const expected = count > reason.maximum ? reason.maximum : reason.minimum;
      context.report(checkerDiagnostics.typeArgumentCount(site.span, name, expected, count));
      return;
    }
    case 'reference':
      context.unsupported(site, frontier.reference);
      return;
    case 'conflict':
      context.report(checkerDiagnostics.cannotInfer(site.span, name, reason.parameter.name.text));
      return;
    case 'arguments':
      for (const { index, expected } of reason.misfits) {
        const argument = request.arguments[index];
        if (argument?.type !== undefined) {
          context.fit(argument.type, expected, argument.node);
        } else if (argument !== undefined) {
          context.expect(argument.node, expected);
        }
      }
      return;
    default: {
      const unexplained: never = reason;
      throw new TypeError(`No explanation for ${JSON.stringify(unexplained)}.`);
    }
  }
}
