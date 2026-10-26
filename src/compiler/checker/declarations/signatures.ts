/**
 * What a function declaration promises before its body is checked: its parameters and declared
 * result (§3.3).
 *
 * - A declared function's parameters carry types; the parser keeps them required. `&T` takes a
 *   reference (§3.7).
 * - An async function declares its real result, `Future<T>`; its body produces the `T` (§3.3).
 * - A parameter's default (§3.3) is checked as part of one body per function, in which each
 *   default sees the parameters before it (`DefaultValues`). A parameter with a default may omit
 *   its type, which is then the default's. Every parameter after one with a default has one too,
 *   since a call gives its arguments in order; a struct's or a variant's fields, read as
 *   parameters (syntax/derived-functions.ts), are named in a literal, so any of them may have one.
 *   Rest parameters are sugar the checker doesn't expand yet.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { isFieldsFunction } from '../../syntax/derived-functions.ts';
import type { Expression, Parameter } from '../../syntax/expressions.ts';
import type { SignatureParameter } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { frontier } from '../frontier.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { futureArgument, futureOf } from '../types/well-known.ts';

/** Where a function's defaults are checked: one body, seeing each parameter once declared. */
export interface DefaultValues {
  /** Checks a default value against the parameter's declared type, if any; the value's type. */
  readonly check: (value: Expression, declared: Type | undefined) => Type;
  /** Makes a parameter visible to the defaults after it. */
  readonly declare: (parameter: Parameter, type: Type) => void;
}

/** The parameters of `declaration`, their types resolved in its module, its defaults checked. */
export function declaredParameters(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
  defaults: DefaultValues | undefined,
): readonly SignatureParameter[] {
  let afterDefault = false;
  const inOrder = !isFieldsFunction(declaration);
  return declaration.parameters.flatMap((node) => {
    if (node.kind === 'Invalid') {
      return [];
    }
    if (node.isRest) {
      checker.unsupported(module, node, frontier.restParameter);
    }
    const declared = node.type === undefined ? undefined : checker.resolveType(module, node.type);
    const { defaultValue } = node;
    if (defaultValue === undefined && afterDefault && inOrder && !node.isRest) {
      checker.report(module, checkerDiagnostics.defaultMissing(node.name.span, node.name.text));
    }
    afterDefault ||= defaultValue !== undefined;
    const valueType =
      defaultValue === undefined || defaults === undefined
        ? undefined
        : defaults.check(defaultValue, declared);
    const type = declared ?? valueType ?? errorType;
    defaults?.declare(node, type);
    return [{ node, type, reference: writtenByReference(node) }];
  });
}

/** Whether `node` is written as taking a reference, `&T` (§3.7). */
export function writtenByReference(node: Parameter): boolean {
  return node.type?.kind === 'ReferenceType';
}

/**
 * What the body of `declaration` must produce, when its result is declared: the result itself,
 * or `T` from an async function's `Future<T>`. Undefined when the result is to be inferred.
 */
export function declaredBodyResult(
  checker: CheckerContext,
  module: ModuleId,
  declaration: Pick<FunctionDeclaration, 'isAsync' | 'returnType'>,
): Type | undefined {
  if (declaration.returnType === undefined) {
    return undefined;
  }
  const declared = checker.resolveType(module, declaration.returnType);
  if (!declaration.isAsync || declared.kind === 'error') {
    return declared;
  }
  const future = futureArgument(checker, declared);
  if (future === undefined) {
    checker.report(
      module,
      checkerDiagnostics.asyncResult(declaration.returnType.span, typeText(declared)),
    );
    return errorType;
  }
  return future;
}

/** What calling `declaration` yields, given what its body produces. */
export function callResult(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
  bodyResult: Type,
): Type {
  return declaration.isAsync ? futureOf(checker, bodyResult) : bodyResult;
}
