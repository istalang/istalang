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
 *   parameters (syntax/field-defaults.ts), are named in a literal, so any of them may have one.
 * - A rest parameter is the last, an `Array<T>` with no default (§3.3): a call it collects nothing
 *   into gives it an empty array.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Expression, Parameter } from '../../syntax/expressions/index.ts';
import { isFieldsFunction } from '../../syntax/field-defaults.ts';
import { unparenthesizedType } from '../../syntax/types.ts';
import type { SignatureParameter } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isPack, packRestSlot, type RestSlot } from '../types/function-types.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { arrayElement, futureArgument, futureOf } from '../types/well-known.ts';

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
  const last = declaration.parameters.at(-1);
  return declaration.parameters.flatMap((node) => {
    if (node.kind === 'Invalid') {
      return [];
    }
    const declared = node.type === undefined ? undefined : checker.resolveType(module, node.type);
    if (node.isRest) {
      checkRest(checker, module, { node, declared, isLast: node === last });
    }
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
    return [signatureParameter(checker, node, type)];
  });
}

/**
 * The parameters of `declaration` as written, a type taken from a default read as the error type.
 * It reports nothing, so it can stand for the parameters while their defaults reach them.
 */
export function writtenParameters(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): readonly SignatureParameter[] {
  return declaration.parameters.flatMap((node) =>
    node.kind === 'Invalid'
      ? []
      : [
          signatureParameter(
            checker,
            node,
            node.type === undefined ? errorType : checker.resolveType(module, node.type),
          ),
        ],
  );
}

function signatureParameter(
  checker: CheckerContext,
  node: Parameter,
  type: Type,
): SignatureParameter {
  return { node, type, reference: writtenByReference(node), rest: restSlotOf(checker, node, type) };
}

/** What a rest parameter of type `type` collects into: a pack's tuple, or an array of its items. */
function restSlotOf(checker: CheckerContext, node: Parameter, type: Type): RestSlot | undefined {
  if (!node.isRest) {
    return undefined;
  }
  return isPack(type)
    ? packRestSlot
    : { kind: 'array', item: arrayElement(checker, type) ?? errorType };
}

/** Reports what a rest parameter breaks of its rules: last, an array or a pack, no default (§3.3). */
function checkRest(
  checker: CheckerContext,
  module: ModuleId,
  rest: { readonly node: Parameter; readonly declared: Type | undefined; readonly isLast: boolean },
): void {
  const { node, declared, isLast } = rest;
  const { name } = node;
  if (!isLast) {
    checker.report(module, checkerDiagnostics.restNotLast(name.span, name.text));
  }
  if (node.defaultValue !== undefined) {
    checker.report(module, checkerDiagnostics.restDefault(name.span, name.text));
  }
  const collects =
    declared === undefined ||
    declared.kind === 'error' ||
    isPack(declared) ||
    arrayElement(checker, declared) !== undefined;
  if (!collects) {
    const at = node.type?.span ?? name.span;
    checker.report(module, checkerDiagnostics.restNotArray(at, name.text, typeText(declared)));
  }
}

/** Whether `node` is written as taking a reference, `&T` (§3.7), parentheses aside. */
export function writtenByReference(node: Parameter): boolean {
  return node.type !== undefined && unparenthesizedType(node.type).kind === 'ReferenceType';
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
