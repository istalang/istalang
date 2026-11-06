/**
 * Lambdas and local functions (§3.14): each is a function value, checked inside the body holding
 * it, in a FunctionScope of its own (functions.ts).
 *
 * - A lambda's parameter has its written type, or else the expected function type's, found
 *   through the optionals a value is wrapped into where one is expected (§2). One with
 *   neither is reported, as nothing could give it. Its result is its written type, or else the
 *   expected function type's, so a named lambda passed where a function is expected may call
 *   itself (§2); with neither, it is what the body produces, as it is for a lambda whose result
 *   binds a type parameter of the call it is passed to (§3.5, `inferLambda`).
 * - A local `fn` is a `const` bound to a lambda (§3.14): its parameters are typed as a declared
 *   function's are, and its result is written or inferred. Being one value, neither a lambda nor a
 *   local `fn` can be generic or have default values or an array's rest parameter, which stand for
 *   overloads (§3.3). Its rest may be a pack of the function around it (§3.5), which each
 *   instantiation flattens into single parameters, so its type ends in that pack.
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

import {
  type FunctionDeclaration,
  nestedFunctionSpan,
} from '../../../syntax/declarations/index.ts';
import type { Lambda, Parameter } from '../../../syntax/expressions/index.ts';
import { parameterSite } from '../../../syntax/expressions/parameters.ts';
import type { Identifier, Invalid } from '../../../syntax/node.ts';
import type { AnchoredSpan } from '../../../syntax/positions.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { SignatureParameter } from '../../check.ts';
import type { Accepts, BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { Produced } from '../../rules/agreement.ts';
import type { NestedFunction } from '../../surface/checked-body.ts';
import { expectedFunction } from '../../types/fitting/expected.ts';
import { isSendable } from '../../types/traits/sendable.ts';
import { isPack, packRestSlot, type RestSlot, withPack } from '../../types/type/function-types.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { errorType, expectsError, unitType } from '../../types/type/primitives.ts';
import {
  checkPatternParameter,
  declaredBodyResult,
  wholeWrittenTypeOf,
  writtenByReference,
  writtenTypeOf,
} from '../declarations/functions/signatures.ts';
import { declareParameter } from '../patterns/targets.ts';
import { FunctionScope } from './function-scope.ts';
import { declareOwnCall } from './own-calls.ts';
import { blockTail, ReturnScope } from './returns.ts';

/**
 * For a lambda with a parameter to infer, which parameter types it can take, as an argument the
 * chosen function decides (§3.5); undefined for one whose parameters are all typed. A plain lambda
 * takes an async function type too, which it fits made async (§3.14).
 */
export function lambdaAccepts(context: BodyContext, node: Lambda): Accepts | undefined {
  const { checker, module } = context;
  const parameters = node.parameters.filter((parameter) => parameter.kind === 'Parameter');
  if (
    parameters.every((parameter) => wholeWrittenTypeOf(checker, module, parameter) !== undefined)
  ) {
    return undefined;
  }
  const fixed = parameters.filter((parameter) => !parameter.isRest).length;
  const hasRest = fixed < parameters.length;
  return (expected) => {
    const shape = expectedFunction(expected);
    return (
      shape !== undefined &&
      (shape.isAsync || !node.isAsync) &&
      shape.parameters.length === fixed &&
      (shape.pack !== undefined) === hasRest &&
      parameters.every(
        (parameter, index) =>
          parameter.pattern === undefined || shape.parameters[index]?.reference !== true,
      )
    );
  };
}

export function checkLambda(context: BodyContext, node: Lambda, expected: Type | undefined): Type {
  const checked = context.functions.checkedOf(node);
  if (checked !== undefined) {
    return checked.type;
  }
  const shape = expectedFunction(expected);
  const slots = shape ?? (expectsError(expected) ? errorSlots(node) : undefined);
  return checkLambdaAs(context, node, slots, shape?.result);
}

/**
 * A lambda expected of the error type, its cause reported: every parameter is of the error type.
 */
function errorSlots(node: Lambda): ParameterSlots {
  const parameters = node.parameters.map(() => ({ type: errorType, reference: false }));
  return { parameters, pack: errorType };
}

/**
 * A lambda passed where its parameters' types are known and its result is its body's to decide,
 * since it binds type parameters of the call (§3.5).
 */
export function inferLambda(context: BodyContext, node: Lambda, slots: ParameterSlots): Type {
  return checkLambdaAs(context, node, slots, undefined);
}

/** What an expected function type gives a lambda's parameters: their slots, and any pack. */
type ParameterSlots = Pick<FunctionType, 'parameters' | 'pack'>;

/** A lambda where its position gives `slots` for its parameters and `result`, when it does. */
function checkLambdaAs(
  context: BodyContext,
  node: Lambda,
  slots: ParameterSlots | undefined,
  result: Type | undefined,
): Type {
  const declaredResult =
    node.returnType === undefined
      ? result
      : declaredBodyResult(context.checker, context.module, node);
  return checkNested(context, node, {
    name: node.name,
    parameters: nestedParameters(context, node.parameters, slots),
    isAsync: node.isAsync,
    declaredResult,
    reach: node.span,
    tail: (declared) => {
      const type = context.expression(node.body, declared);
      return { type, span: node.body.span, site: node.body };
    },
  });
}

/** A local `fn`: its name, a `const` holding the function, from here on (§3.14). */
export function checkLocalFunction(context: BodyContext, node: FunctionDeclaration): Type {
  const body = context.checker.inputs.bodyOf(context.module, node);
  if (node.typeParameters.length > 0) {
    context.report(checkerDiagnostics.nestedFunctionForm(node.name.span, 'type parameters'));
  }
  if (body !== undefined) {
    checkNested(context, node, {
      name: node.name,
      parameters: nestedParameters(context, node.parameters, undefined),
      isAsync: node.isAsync,
      declaredResult: declaredBodyResult(context.checker, context.module, node),
      reach: nestedFunctionSpan(node, body),
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
  /** What the function's text covers, header and body. */
  readonly reach: AnchoredSpan;
  /** Checks the body, expecting `declared` of it; its tail. */
  readonly tail: (declared: Type | undefined) => Produced;
}

function checkNested(context: BodyContext, node: NestedFunction, header: NestedHeader): Type {
  const { name, parameters, isAsync, declaredResult } = header;
  const rest = parameters.find((parameter) => parameter.rest !== undefined);
  const slots = parameters
    .filter((parameter) => parameter !== rest)
    .map((parameter) => ({ type: parameter.type, reference: parameter.reference }));
  const typeWith = (produces: Type, sendable = false): FunctionType =>
    withPack(
      { kind: 'function', isSendable: sendable, isAsync, parameters: slots, result: produces },
      rest?.type,
    );
  if (name !== undefined && declaredResult !== undefined) {
    context.variables.declare(name, typeWith(declaredResult));
  }
  const scope = new FunctionScope(
    node,
    isAsync,
    new ReturnScope(declaredResult, true),
    header.reach,
  );
  const result = context.functions.inside(scope, () => {
    for (const parameter of parameters) {
      declareParameter(context, parameter);
    }
    declareOwnCall(context);
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
        !context.variables.isChangeable(capture.entity) &&
        isSendable(context.checker, capture.type),
    ),
  );
  if (name !== undefined) {
    context.variables.declare(name, type);
  }
  context.functions.record(node, { type, parameters, captures });
  return type;
}

/**
 * A nested function's parameters: each written type, its annotation or the type its pattern names
 * whole, or else the slot of the expected function type at its position, a reference if the slot
 * takes one, and for a rest parameter the expected type's pack; a generic type its pattern names
 * bare takes its type arguments from that slot, and is resolved as written only where there is
 * none, which reports them missing. Default values, and a rest parameter that isn't a pack, are
 * refused (§3.14).
 */
function nestedParameters(
  context: BodyContext,
  nodes: readonly (Parameter | Invalid)[],
  slots: ParameterSlots | undefined,
): readonly SignatureParameter[] {
  return nodes.flatMap((node, index) => {
    if (node.kind === 'Invalid') {
      return [];
    }
    const site = parameterSite(node);
    if (node.defaultValue !== undefined) {
      context.report(checkerDiagnostics.nestedFunctionForm(site.span, 'default values'));
    }
    const { checker, module } = context;
    const parameter =
      typedAs(context, node, wholeWrittenTypeOf(checker, module, node)) ??
      expectedSlot(node, index, slots) ??
      typedAs(context, node, writtenTypeOf(checker, module, node));
    checkPatternParameter(context, node, parameter?.reference === true);
    if (node.isRest && parameter !== undefined && !fillsRest(parameter.type)) {
      const form = "an array's rest parameter";
      context.report(checkerDiagnostics.nestedFunctionForm(site.span, form));
    }
    if (parameter === undefined) {
      const count = slots?.parameters.length;
      context.report(checkerDiagnostics.parameterTypeUnknown(site.span, node.name?.text, count));
      return [{ node, type: errorType, reference: false, rest: restOf(node) }];
    }
    return [{ node, ...parameter, rest: restOf(node) }];
  });
}

/** What a nested function's parameter collects into: a rest parameter, a pack's tuple (§3.14). */
function restOf(node: Parameter): RestSlot | undefined {
  return node.isRest ? packRestSlot : undefined;
}

/** Whether a nested function's rest may be of type `type`: a pack, or a mistake reported. */
function fillsRest(type: Type): boolean {
  return isPack(type) || type.kind === 'error';
}

/** What the expected function type gives the parameter `node` at `index`: its slot, or its pack. */
function expectedSlot(
  node: Parameter,
  index: number,
  slots: ParameterSlots | undefined,
): FunctionType['parameters'][number] | undefined {
  if (!node.isRest) {
    return slots?.parameters[index];
  }
  return slots?.pack === undefined ? undefined : { type: slots.pack, reference: false };
}

/**
 * `node` typed as `written` says, a reference if it writes one; undefined where none is written.
 */
function typedAs(
  context: BodyContext,
  node: Parameter,
  written: TypeNode | undefined,
): { readonly type: Type; readonly reference: boolean } | undefined {
  return written === undefined
    ? undefined
    : { type: context.resolveType(written), reference: writtenByReference(node) };
}
