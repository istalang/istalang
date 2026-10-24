/**
 * What a declaration promises before its body is checked: a function's parameters and declared
 * result (§3.3), a struct's fields (§3.1).
 *
 * - A declared function's parameters carry types; the parser keeps them required. `&T` takes a
 *   reference (§3.7).
 * - An async function declares its real result, `Future<T>`; its body produces the `T` (§3.3).
 * - Defaults and rest parameters (§3.3) are sugar the checker doesn't expand yet.
 * - Fields, of a struct or of an enum's variant, resolve in the declaring module.
 */

import type { ModuleId } from '../../program/program.ts';
import type {
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
} from '../../syntax/declarations.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { FieldDeclaration } from '../../syntax/types.ts';
import type { FieldMember, SignatureParameter } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { futureArgument, refuseHeldFuture } from '../rules/futures.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** The parameters of `declaration`, their types resolved in its module. */
export function declaredParameters(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): readonly SignatureParameter[] {
  return declaration.parameters.flatMap((node) => {
    if (node.kind === 'Invalid') {
      return [];
    }
    if (node.isRest || node.defaultValue !== undefined) {
      checker.unsupported(module, node, node.isRest ? 'Rest parameter' : 'Default value');
    }
    const type = node.type === undefined ? errorType : checker.resolveType(module, node.type);
    refuseHeldFuture(checker, module, node, type);
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
  return declaration.isAsync ? checker.preludeType('Future', [bodyResult]) : bodyResult;
}

/**
 * The fields of a struct declaration or of an enum variant, their types resolved in the module of
 * `owner`, the declaration holding them, but not substituted.
 */
export function declaredFields(
  checker: CheckerContext,
  owner: StructDeclaration | EnumDeclaration,
  fields: readonly (FieldDeclaration | Invalid)[],
): readonly FieldMember[] {
  const module = checker.moduleOf(owner);
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
