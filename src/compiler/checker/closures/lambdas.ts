/**
 * Lambdas and local functions (§3.14): each is a function value, checked inside the body holding
 * it, in a FunctionScope of its own (functions.ts).
 *
 * - A lambda's parameter has its written type, or else the expected function type's. One with
 *   neither is reported, as nothing could give it. Its result is its written type, or else the
 *   expected function type's, so a named lambda passed where a function is expected may call
 *   itself (§2); with neither, it is what the body produces.
 * - A local `fn` is a `const` bound to a lambda (§3.14): its parameters are typed as a declared
 *   function's are, and its result is written or inferred. Being one value, neither a lambda nor a
 *   local `fn` can be generic or have default values or rest parameters, which stand for overloads
 *   (§3.3).
 * - An async function's written result is its `Future<T>`, as for a declared one (§3.3); its
 *   function type's result is the `T` an `await` on a call yields.
 * - The function's own name, a local `fn`'s or a named lambda's, is declared before the body is
 *   checked when the result is known, so the body may call it; otherwise calling it is recursion
 *   needing a declared result (functions.ts).
 * - Its type is sendable when every capture is a copy of a sendable value: a captured `let` is a
 *   cell (§3.14), so a function capturing one isn't (§9). Inside its own body, its name has the
 *   plain type, since what it captures is known only once the body is checked.
 * - The type is recorded with the parameters and captures for lowering (`functionOf`).
 */

import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Lambda, Parameter } from '../../syntax/expressions.ts';
import type { Identifier, Invalid } from '../../syntax/node.ts';
import type { SignatureParameter } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { declaredBodyResult, writtenByReference } from '../declarations/signatures.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Produced } from '../rules/agreement.ts';
import { isChangeable } from '../rules/places.ts';
import { blockTail, ReturnScope } from '../statements/returns.ts';
import { isSendable } from '../traits/sendable.ts';
import { errorType, type FunctionType, type Type, unitType } from '../types/type.ts';
import { FunctionScope, type NestedFunction } from './function-scope.ts';

export function checkLambda(context: BodyContext, node: Lambda, expected: Type | undefined): Type {
  const shape = expected?.kind === 'function' ? expected : undefined;
  const fromShape = shape?.result.kind === 'error' ? undefined : shape?.result;
  const declaredResult =
    node.returnType === undefined
      ? fromShape
      : declaredBodyResult(context.checker, context.module, node);
  return checkNested(context, node, {
    name: node.name,
    parameters: nestedParameters(context, node.parameters, shape),
    isAsync: node.isAsync,
    declaredResult,
    tail: (declared) => {
      const type = context.expression(node.body, declared);
      return { type, span: node.body.span, node: node.body };
    },
  });
}

/** A local `fn`: its name, a `const` holding the function, from here on (§3.14). */
export function checkLocalFunction(context: BodyContext, node: FunctionDeclaration): Type {
  const { body } = node;
  if (node.typeParameters.length > 0) {
    context.report(checkerDiagnostics.nestedFunctionForm(node.name.span, 'type parameters'));
  }
  if (body !== undefined) {
    checkNested(context, node, {
      name: node.name,
      parameters: nestedParameters(context, node.parameters, undefined),
      isAsync: node.isAsync,
      declaredResult: declaredBodyResult(context.checker, context.module, node),
      tail: (declared) => blockTail(body, context.block(body, declared)),
    });
  }
  return unitType;
}

/** What checking a nested function needs beyond its node. */
interface NestedHeader {
  readonly name: Identifier | undefined;
  readonly parameters: readonly SignatureParameter[];
  readonly isAsync: boolean;
  readonly declaredResult: Type | undefined;
  /** Checks the body, expecting `declared` of it; its tail. */
  readonly tail: (declared: Type | undefined) => Produced;
}

function checkNested(context: BodyContext, node: NestedFunction, header: NestedHeader): Type {
  const { name, parameters, isAsync, declaredResult } = header;
  const slots = parameters.map((parameter) => ({
    type: parameter.type,
    reference: parameter.reference,
  }));
  const typeWith = (produces: Type, sendable = false): FunctionType => ({
    kind: 'function',
    isSendable: sendable,
    isAsync,
    parameters: slots,
    result: produces,
  });
  if (name !== undefined && declaredResult !== undefined) {
    context.variables.declare(name, typeWith(declaredResult));
  }
  const scope = new FunctionScope(node, isAsync, new ReturnScope(declaredResult, true));
  const result = context.functions.inside(scope, () => {
    for (const parameter of parameters) {
      context.variables.declareParameter(parameter);
    }
    return scope.returns.result(context, header.tail(declaredResult));
  });
  const captures = [...scope.captures.values()].map((entity) => ({
    entity,
    type: context.variables.typeOf(entity),
  }));
  const type = typeWith(
    result,
    captures.every(
      (capture) =>
        !isChangeable(context, capture.entity) && isSendable(context.checker, capture.type),
    ),
  );
  if (name !== undefined) {
    context.variables.declare(name, type);
  }
  context.functions.record(node, {
    type,
    parameters: parameters.map((parameter) => parameter.node),
    captures,
  });
  return type;
}

/**
 * A nested function's parameters: each written type, or else the slot of the expected function
 * type at its position, a reference if the slot takes one; default values and rest parameters are
 * refused.
 */
function nestedParameters(
  context: BodyContext,
  nodes: readonly (Parameter | Invalid)[],
  shape: FunctionType | undefined,
): readonly SignatureParameter[] {
  return nodes.flatMap((node, index) => {
    if (node.kind === 'Invalid') {
      return [];
    }
    if (node.defaultValue !== undefined) {
      context.report(checkerDiagnostics.nestedFunctionForm(node.name.span, 'default values'));
    }
    if (node.isRest) {
      context.report(checkerDiagnostics.nestedFunctionForm(node.name.span, 'a rest parameter'));
    }
    const slot = shape?.parameters[index];
    const parameter = writtenParameter(context, node) ?? slot;
    if (parameter === undefined) {
      context.report(
        checkerDiagnostics.parameterTypeUnknown(
          node.name.span,
          node.name.text,
          shape?.parameters.length,
        ),
      );
      return [{ node, type: errorType, reference: false }];
    }
    return [{ node, ...parameter }];
  });
}

function writtenParameter(
  context: BodyContext,
  node: Parameter,
): { readonly type: Type; readonly reference: boolean } | undefined {
  return node.type === undefined
    ? undefined
    : { type: context.resolveType(node.type), reference: writtenByReference(node) };
}
