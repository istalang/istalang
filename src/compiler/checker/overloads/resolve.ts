/**
 * Choosing the function a call means among the overloads of its name (§3.7): calls are resolved
 * from the argument types alone, never from the result.
 *
 * For now a candidate applies when it is not generic, takes exactly as many parameters as there
 * are arguments, takes none of them by reference, and every argument fits its parameter. Generic
 * candidates, defaults, rest parameters, references and argument-dependent lookup extend this
 * module; until then a call that only a generic candidate could serve is reported as not supported.
 */

import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { CallSite } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { errorType, isAssignable, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** The candidates a call with `argumentTypes` could mean. */
export function applicableOverloads(
  context: BodyContext,
  candidates: readonly FunctionDeclaration[],
  argumentTypes: readonly Type[],
): readonly FunctionDeclaration[] {
  return candidates.filter((candidate) => {
    if (candidate.typeParameters.length > 0) {
      return false;
    }
    const parameters = context.checker.parametersOf(candidate);
    return (
      parameters.length === argumentTypes.length &&
      parameters.every(
        (parameter, index) =>
          !parameter.reference && isAssignable(argumentTypes[index] ?? errorType, parameter.type),
      )
    );
  });
}

/** A call to resolve: where it is, the functions it may mean, and its arguments' types. */
export interface OverloadRequest {
  readonly site: CallSite;
  readonly candidates: readonly FunctionDeclaration[];
  readonly argumentTypes: readonly Type[];
}

/** A call written by name: the request, with the name and the arguments it was written with. */
export interface CallAttempt extends OverloadRequest {
  readonly name: string;
  readonly argumentNodes: readonly Expression[];
}

/** Why no single candidate was chosen. */
export type OverloadFailure = 'none' | 'several';

/**
 * Resolves `request` among its candidates by the argument types, recording its target; its result
 * type. When no single candidate applies, `fail` reports why, and the result is the error type.
 * An argument of the error type was already reported, so nothing more is.
 */
export function resolveOverload(
  context: BodyContext,
  request: OverloadRequest,
  fail: (failure: OverloadFailure) => void,
): Type {
  const { site, candidates, argumentTypes } = request;
  if (argumentTypes.some((type) => type.kind === 'error')) {
    return errorType;
  }
  const matches = applicableOverloads(context, candidates, argumentTypes);
  const [match] = matches;
  if (matches.length === 1 && match !== undefined) {
    return callTo(context, site, match);
  }
  fail(matches.length === 0 ? 'none' : 'several');
  return errorType;
}

/** Resolves a call written by name, explaining a failure as precisely as the candidates allow. */
export function resolveCall(context: BodyContext, attempt: CallAttempt): Type {
  const { site, name, argumentTypes } = attempt;
  return resolveOverload(context, attempt, (failure) => {
    if (failure === 'several') {
      context.report(checkerDiagnostics.ambiguousCall(site.span, name, typesText(argumentTypes)));
      return;
    }
    explainNone(context, attempt);
  });
}

/** Why none of the candidates takes the call's arguments. */
function explainNone(context: BodyContext, attempt: CallAttempt): void {
  const { site, name, candidates, argumentTypes } = attempt;
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) {
    explainSingle(context, attempt, only);
  } else if (candidates.some((candidate) => candidate.typeParameters.length > 0)) {
    context.unsupported(site, 'Calling a generic function');
  } else {
    context.report(
      checkerDiagnostics.noMatchingOverload(site.span, name, typesText(argumentTypes)),
    );
  }
}

/**
 * Records the call at `site` to `target`; what the call yields. Externs outside the std modules
 * need a host to implement them, so they are reported as not supported yet.
 */
export function callTo(context: BodyContext, site: CallSite, target: FunctionDeclaration): Type {
  if (!checkCallable(context, site, target)) {
    return errorType;
  }
  context.recordCall(site, { function: target, typeArguments: [] });
  return context.checker.resultOf(target);
}

/**
 * The checker's frontier for calls: whether the rest of the toolchain can run a call to `target`
 * yet, reporting at `site` when it can't. Each feature that can run more calls moves this line.
 */
function checkCallable(context: BodyContext, site: CallSite, target: FunctionDeclaration): boolean {
  const { checker } = context;
  if (target.isExtern && checker.program.modules.get(checker.moduleOf(target))?.isStd !== true) {
    context.unsupported(site, 'Calling an extern function the host implements');
    return false;
  }
  return true;
}

/** The types as a call's argument list reads: `int, string`. */
export function typesText(types: readonly Type[]): string {
  return types.map(typeText).join(', ');
}

/** With one candidate, the report says what exactly doesn't fit. */
function explainSingle(
  context: BodyContext,
  attempt: CallAttempt,
  candidate: FunctionDeclaration,
): void {
  const { site, argumentNodes, argumentTypes } = attempt;
  const parameters = context.checker.parametersOf(candidate);
  if (candidate.typeParameters.length > 0) {
    context.unsupported(site, 'Calling a generic function');
  } else if (parameters.length !== argumentTypes.length) {
    context.report(
      checkerDiagnostics.argumentCount(
        site.span,
        candidate.name.text,
        parameters.length,
        argumentTypes.length,
      ),
    );
  } else if (parameters.some((parameter) => parameter.reference)) {
    context.unsupported(site, 'Passing a reference');
  } else {
    parameters.forEach((parameter, index) => {
      const found = argumentTypes[index] ?? errorType;
      const node = argumentNodes[index];
      if (node !== undefined && !isAssignable(found, parameter.type)) {
        context.report(
          checkerDiagnostics.typeMismatch(node.span, typeText(parameter.type), typeText(found)),
        );
      }
    });
  }
}
