/**
 * Resolving a call in a body (§3.3, §3.7, §3.9): its arguments choose among the candidates
 * (choice.ts), the choice is instantiated with its constraints met (traits/conformance.ts), and
 * the call is recorded for lowering with its arguments fitted, so their implicit wraps are too.
 *
 * - An argument whose type the chosen function decides (`none`, a bare variant, a lambda with an
 *   untyped parameter) is checked only after choosing, against its parameter's type; a lambda,
 *   before instantiating, so its result can bind type parameters (closures/lambda-arguments.ts).
 * - A method call records its receiver with the call, as lowering passes it first (§3.7). A
 *   receiver the chosen function's `self` takes by reference must be a place that may change.
 * - An argument of the error type was already reported, so the call reports nothing more.
 * - A failure is explained as precisely as the candidates allow: with one candidate, what exactly
 *   doesn't fit it, as choosing decided it, so an explanation never disagrees with the choice.
 * - Calling `dispose` directly is refused, since the runtime calls it once nothing holds a value
 *   (§7). The rules every call obeys, witnesses of constraints included, apply where the call is
 *   made (calls-made.ts).
 */

import { disposeFunction } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { CallSite } from '../check.ts';
import { checkDecidedLambdas } from '../closures/lambda-arguments.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { changeReceiver, checkReferencedPlaces } from '../rules/places.ts';
import { type Instantiation, instantiate } from '../traits/conformance.ts';
import { errorType, substitute, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { useSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import type { Candidate } from './candidates.ts';
import { type Application, choose, type Inapplicability, type Passing } from './choice.ts';

/**
 * An argument as written: its node, how it is passed, and its type, undefined when the chosen
 * function decides it, with which parameter types it can take (choice.ts).
 */
export interface WrittenArgument {
  readonly node: Expression;
  readonly passing: Passing;
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
  /** A method call's receiver, its first argument (§3.7). */
  readonly receiver?: Expression;
}

/** Resolves `request`, recording the call; what it yields, or the error type after a report. */
export function resolveCall(context: BodyContext, request: CallRequest): Type {
  const written = request.arguments;
  if (written.some(({ type }) => type?.kind === 'error')) {
    return errorType;
  }
  const callArguments = written.map(({ type, passing, accepts }) => ({ type, passing, accepts }));
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

/** The types of written arguments, as a call's argument list reads: `&Stack, int`. */
export function typesText(written: readonly WrittenArgument[]): string {
  return written
    .map(({ type, passing }) => {
      const text = type === undefined ? '_' : typeText(type);
      return passing === 'reference' ? `&${text}` : text;
    })
    .join(', ');
}

function complete(context: BodyContext, request: CallRequest, application: Application): Type {
  const { site } = request;
  const lambdas = checkDecidedLambdas(context, request.arguments, application);
  const instantiation = instantiate(
    useSite(context.checker, context.module, site.span),
    application,
    request.expected,
  );
  if (instantiation === undefined) {
    return errorType;
  }
  const { signature } = application;
  fitArguments(
    context,
    request.arguments,
    signature.parameters.map((slot) => substitute(slot.type, instantiation.substitution)),
    lambdas,
  );
  const { receiver } = request;
  const arity = request.arguments.length;
  if (!recordChosen(context, { site, application, instantiation, arity, receiver })) {
    return errorType;
  }
  if (receiver !== undefined && signature.parameters[0]?.reference === true) {
    changeReceiver(context, receiver, request.name);
  }
  checkReferencedPlaces(context, request.arguments, {
    name: request.name,
    isAsync: signature.declaration.isAsync,
    slots: signature.parameters,
  });
  return substitute(signature.result(), instantiation.substitution);
}

/** A chosen function, instantiated, at the site calling it or naming it as a value. */
export interface Chosen {
  readonly site: CallSite;
  readonly application: Application;
  readonly instantiation: Instantiation;
  /** How many arguments the call gives, or the function value takes. */
  readonly arity: number;
  readonly receiver?: Expression | undefined;
}

/**
 * Records the call `chosen` makes, under the rules every written call obeys: `dispose` is the
 * runtime's to call (§7). False after a report.
 */
export function recordChosen(context: BodyContext, chosen: Chosen): boolean {
  const { site, application, instantiation, arity, receiver } = chosen;
  if (application.signature.declaration.name.text === disposeFunction) {
    context.report(checkerDiagnostics.disposeCall(site.span));
    return false;
  }
  const call = callMade(application.candidate, instantiation, arity);
  context.recordCall(site, receiver === undefined ? call : { ...call, receiver });
  return true;
}

/**
 * Fits each argument of a call that takes them to its parameter's type, `expected` by position,
 * checking first one the function decides; `decided` holds the types of those already checked.
 */
export function fitArguments(
  context: BodyContext,
  written: readonly WrittenArgument[],
  expected: readonly Type[],
  decided: ReadonlyMap<number, Type> = new Map(),
): void {
  written.forEach(({ node, type }, index) => {
    const parameter = expected[index];
    if (parameter !== undefined) {
      const checked = type ?? decided.get(index) ?? context.expression(node, parameter);
      context.fit(checked, parameter, node);
    }
  });
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
    case 'reference': {
      const at = request.arguments[reason.index]?.node.span ?? site.span;
      context.report(checkerDiagnostics.passing(at, name, reason.index + 1, reason.reference));
      return;
    }
    case 'conflict':
      context.report(checkerDiagnostics.cannotInfer(site.span, name, reason.parameter.name.text));
      return;
    case 'arguments':
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
      return;
    default: {
      const unexplained: never = reason;
      unreachable(`No explanation for ${JSON.stringify(unexplained)}.`);
    }
  }
}
