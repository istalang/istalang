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
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import type { Identifier, Invalid } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { SignatureParameter } from '../../check.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { Produced } from '../../rules/agreement.ts';
import { blockTail, producedBy } from '../../rules/agreement.ts';
import type { NestedFunction } from '../../surface/checked-body.ts';
import type { Admits } from '../../types/fitting/expected.ts';
import { expectedFunction } from '../../types/fitting/expected.ts';
import { isSendable } from '../../types/traits/sendable.ts';
import { isPack, packRestSlot, type RestSlot, withPack } from '../../types/type/function-types.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { errorType, expectsError, neverType, unitType } from '../../types/type/primitives.ts';
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
import { type GuidedResult, ReturnScope } from './returns.ts';

/**
 * For a lambda whose result isn't written, or with a parameter to infer, which parameter types it
 * can take, as an argument the chosen function decides (§3.5): its body then has what the call
 * expects of its result as a guide, as Kotlin's lambdas do. Undefined for one written whole,
 * parameters and result, which has a type of its own. A written parameter takes what fits it, and
 * a plain lambda an async function type too, which it fits made async (§3.14).
 */
export function lambdaAccepts(context: BodyContext, node: Lambda): Admits | undefined {
  const { checker } = context;
  const parameters = node.parameters.filter((parameter) => parameter.kind === 'Parameter');
  const written = writtenParameterTypes(context, node);
  if (node.returnType !== undefined && written.every((type) => type !== undefined)) {
    return undefined;
  }
  const fixed = parameters.filter((parameter) => !parameter.isRest).length;
  const hasRest = fixed < parameters.length;
  // A pack still open takes what written parameters are left past the fixed ones (§3.5).
  const isWritten = written.every((type) => type !== undefined) && !hasRest;
  return (expected, isOpen) => {
    const shape = expectedFunction(expected);
    const fillsPack =
      isWritten &&
      shape?.pack !== undefined &&
      isOpen(shape.pack) &&
      shape.parameters.length <= fixed;
    return (
      shape !== undefined &&
      (shape.isAsync || !node.isAsync) &&
      (fillsPack ||
        (shape.parameters.length === fixed && (shape.pack !== undefined) === hasRest)) &&
      parameters.every((parameter, index) => {
        const slot = shape.parameters[index];
        const type = written[index];
        return (
          (parameter.pattern === undefined || slot?.reference !== true) &&
          (type === undefined ||
            slot === undefined ||
            isOpen(slot.type) ||
            checker.fitOf(slot.type, type) !== undefined)
        );
      })
    );
  };
}

/**
 * The function type a lambda's written parameters make it, its result `Never`, which bounds what
 * the call it is passed to gives its parameters and nothing of its result (§3.5); sendable, since
 * what it captures is known only once its body is checked against the parameter (§9). Undefined
 * unless every parameter, and no result, is written.
 */
export function writtenInputs(context: BodyContext, node: Lambda): Type | undefined {
  const written = writtenParameterTypes(context, node);
  const types = written.flatMap((type) => type ?? []);
  const plain = node.parameters.every(
    (parameter) => parameter.kind === 'Parameter' && !parameter.isRest,
  );
  if (node.returnType !== undefined || types.length < written.length || !plain) {
    return undefined;
  }
  return {
    kind: 'function',
    parameters: types.map((type) => ({ type, reference: false })),
    pack: undefined,
    result: neverType,
    isAsync: node.isAsync,
    isSendable: true,
  };
}

/** The types `node`'s parameters are written with, by parameter; undefined where one isn't. */
function writtenParameterTypes(context: BodyContext, node: Lambda): readonly (Type | undefined)[] {
  const { checker, module } = context;
  return node.parameters
    .filter((parameter) => parameter.kind === 'Parameter')
    .map((parameter) => {
      const written = wholeWrittenTypeOf(checker, module, parameter);
      return written === undefined ? undefined : context.resolveType(written);
    });
}

export function checkLambda(context: BodyContext, node: Lambda, expected: Type | undefined): Type {
  const checked = context.functions.checkedOf(node);
  if (checked !== undefined) {
    return checked.type;
  }
  const shape = expectedFunction(expected);
  const slots = shape ?? (expectsError(expected) ? errorSlots(node) : undefined);
  return checkLambdaAs(
    context,
    node,
    slots,
    shape === undefined ? undefined : { kind: 'declared', type: shape.result },
  );
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
 * since it bounds type parameters of the call (§3.5); `guide`, what the call expects of the
 * result, guides the body without declaring the result, open in the call's constraint scope where
 * the call doesn't know it yet, so a body that joins the scope is advised by it.
 */
export function inferLambda(
  context: BodyContext,
  node: Lambda,
  slots: ParameterSlots,
  guide?: Type,
): Type {
  return checkLambdaAs(
    context,
    node,
    slots,
    guide === undefined ? undefined : { kind: 'guided', guide },
  );
}

/** What an expected function type gives a lambda's parameters: their slots, and any pack. */
type ParameterSlots = Pick<FunctionType, 'parameters' | 'pack'>;

/**
 * What a lambda's position says of its result: the type it is declared to give, or how it guides
 * its body only, the result being what the body gives.
 */
type ResultGiven =
  | { readonly kind: 'declared'; readonly type: Type }
  | { readonly kind: 'guided'; readonly guide: Type };

/** A lambda where its position gives `slots` for its parameters and says `result`, when it does. */
function checkLambdaAs(
  context: BodyContext,
  node: Lambda,
  slots: ParameterSlots | undefined,
  result: ResultGiven | undefined,
): Type {
  const hint = result?.kind === 'guided' ? result.guide : undefined;
  const given = result?.kind === 'declared' ? result.type : undefined;
  const declaredResult =
    node.returnType === undefined
      ? given
      : declaredBodyResult(context.checker, context.module, node);
  return checkNested(context, node, {
    name: node.name,
    parameters: nestedParameters(context, node.parameters, slots),
    isAsync: node.isAsync,
    declaredResult,
    guided: hint === undefined ? undefined : { node, guide: hint, scope: context.scopes.current },
    reach: node.span,
    tail: (declared) => {
      const type = context.expression(node.body, declared ?? hint);
      // A body of several statements is a block expression, whose tail produces as a `fn`'s does.
      const body = unparenthesized(node.body);
      return body.kind === 'BlockExpression'
        ? blockTail(body.block, type)
        : producedBy(node.body, type);
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
  /** For a lambda whose result a call is still inferring, what guides its `return`s (returns.ts). */
  readonly guided?: GuidedResult | undefined;
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
    new ReturnScope(declaredResult, true, header.guided),
    header.reach,
  );
  const result = context.functions.inside(scope, () => {
    for (const parameter of parameters) {
      declareParameter(context, parameter);
    }
    declareOwnCall(context);
    return scope.returns.result(context, header.tail(declaredResult));
  });
  // What the scope it stands in judges later inside it may capture more, and what its body gave
  // settles with the scope (contexts/constraint-scope.ts): it is recorded again then.
  const finished = (produces: Type): FunctionType => {
    const captures = [...scope.captures.values()].map((entity) => ({
      entity,
      type: context.variables.typeOf(entity),
    }));
    const sendable = captures.every(
      (capture) =>
        !context.variables.isChangeable(capture.entity) &&
        isSendable(context.checker, capture.type),
    );
    const recorded = typeWith(produces, sendable);
    if (name !== undefined) {
      context.variables.declare(name, recorded);
    }
    context.functions.record(node, { type: recorded, parameters, captures });
    return recorded;
  };
  const type = finished(result);
  if (context.scopes.isOpen) {
    context.scopes.whenSolved((solved) => finished(solved(result)));
  }
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
