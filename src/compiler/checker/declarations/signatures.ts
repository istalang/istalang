/**
 * What a declaration promises before its body is checked: a function's parameters and declared
 * result (§3.3), a struct's fields (§3.1).
 *
 * - A declared function's parameters carry types; the parser keeps them required. `&T` takes a
 *   reference (§3.7).
 * - An async function declares its real result, `Future<T>`; its body produces the `T` (§3.3).
 * - A parameter's default (§3.3) is checked as part of one body per function, in which each
 *   default sees the parameters before it (`DefaultValues`). A parameter with a default may omit
 *   its type, which is then the default's. Every parameter after one with a default has one too.
 *   Rest parameters are sugar the checker doesn't expand yet.
 * - Fields, of a struct, an enum's variant or an anonymous struct type, resolve in the module
 *   writing them.
 * - Code that would hold a future in a parameter or a field is refused (rules/futures.ts); an
 *   extern's parameters are its native's to hold, so they aren't.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Expression, Parameter } from '../../syntax/expressions.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { FieldDeclaration } from '../../syntax/types.ts';
import type { SignatureParameter } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { futureArgument, futureOf, refuseHeldFuture } from '../rules/futures.ts';
import { errorType, type FieldMember, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

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
  return declaration.parameters.flatMap((node) => {
    if (node.kind === 'Invalid') {
      return [];
    }
    if (node.isRest) {
      checker.unsupported(module, node, frontier.restParameter);
    }
    const declared = node.type === undefined ? undefined : checker.resolveType(module, node.type);
    const { defaultValue } = node;
    if (defaultValue === undefined && afterDefault && !node.isRest) {
      checker.report(module, checkerDiagnostics.defaultMissing(node.name.span, node.name.text));
    }
    afterDefault ||= defaultValue !== undefined;
    const valueType =
      defaultValue === undefined || defaults === undefined
        ? undefined
        : defaults.check(defaultValue, declared);
    const type = declared ?? valueType ?? errorType;
    defaults?.declare(node, type);
    if (declaration.body !== undefined) {
      refuseHeldFuture(checker, module, node, type);
    }
    return [{ node, type, reference: node.type?.kind === 'ReferenceType' }];
  });
}

/**
 * What the body of `declaration` must produce, when its result is declared: the result itself,
 * or `T` from an async function's `Future<T>`. Undefined when the result is to be inferred.
 */
export function declaredBodyResult(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
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

/**
 * The fields of a struct declaration, an enum variant or an anonymous struct type, their types
 * resolved in `module`, where they are written, but not substituted.
 */
export function declaredFields(
  checker: CheckerContext,
  module: ModuleId,
  fields: readonly (FieldDeclaration | Invalid)[],
): readonly FieldMember[] {
  return fields.flatMap((field) =>
    field.kind === 'FieldDeclaration'
      ? [{ name: field.name.text, type: fieldType(checker, module, field) }]
      : [],
  );
}

function fieldType(checker: CheckerContext, module: ModuleId, field: FieldDeclaration): Type {
  const type = checker.resolveType(module, field.type);
  refuseHeldFuture(checker, module, field, type);
  return type;
}
