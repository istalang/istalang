/**
 * The type a lambda or local `fn` gets (§3.14): its parameters' slots and pack, what its body
 * gives through its head (an async one's call a future of it), its reach, and its kind (§3.3).
 *
 * - A kind its head writes is its kind, else one its position says, a kind or either; given
 *   neither, its code runs in the kind around it.
 * - Given no kind, a plain one whose code never depended on the kind around it (called or waited
 *   on nothing of a kind) is of either kind, as a lambda infers its kind from its body: it fits an
 *   unmarked field however it was written. An async one keeps the kind around it, which its future
 *   needs.
 * - What its signature holds is judged as a declared function's is
 *   (rules/kinds/signature-kinds.ts).
 */

import { awaits, type FunctionQualifiers } from '../../../syntax/tokens/modifiers.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { SignatureParameter } from '../../check.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { NestedFunction } from '../../surface/checked-body.ts';
import { sameType } from '../../types/identity/identity.ts';
import { capturedSend } from '../../types/traits/sendability.ts';
import { isMarkVariable, simpleMark, writtenKindOf } from '../../types/type/function-kinds.ts';
import { functionType, headResult } from '../../types/type/function-types.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import { cellTypeOf } from '../../types/type/well-known.ts';
import { capturesOf, type FunctionScope } from './function-scope.ts';

/**
 * The kind a nested function's head or position gives it, checked in `context`: its head's, else
 * `expected`, the kind of the function type expected of it, where that is a literal mark or a mark
 * parameter fixed around it (`logged`'s `M` in its own body); never a call's variable its scopes
 * still hold, which its body infers. Undefined where neither does.
 */
export function givenKindOf(
  context: Pick<BodyContext, 'checker' | 'scopes'>,
  qualifiers: FunctionQualifiers,
  expected?: Type,
): Type | undefined {
  const known =
    expected !== undefined &&
    (expected.kind === 'literal' ||
      (isMarkVariable(context.checker, expected) && !context.scopes.holds(expected)))
      ? expected
      : undefined;
  return writtenKindOf(qualifiers) ?? known;
}

/**
 * The kind a lambda given none infers from its parameters (Rule 2): the one kind their types show,
 * where they decide one; undefined where they show none, or both kinds, which the data rule refuses
 * its signature for (rules/kinds/data-kinds.ts).
 */
export function heldKindOf(
  checker: CheckerContext,
  parameters: readonly SignatureParameter[],
): Type | undefined {
  const kinds = parameters.flatMap((parameter) => checker.valueKindsOf(parameter.type));
  const [first] = kinds;
  return first !== undefined && kinds.every((kind) => sameType(kind, first)) ? first : undefined;
}

/** How a nested function of `parameters` is typed, by what it gives, its sendability and mark. */
export function nestedTypeOf(
  context: BodyContext,
  node: NestedFunction,
  parameters: readonly SignatureParameter[],
): (produces: Type, send: Type, mark: Type) => FunctionType {
  const rest = parameters.find((parameter) => parameter.rest !== undefined);
  const slots = parameters
    .filter((parameter) => parameter !== rest)
    .map((parameter) => ({ type: parameter.type, reference: parameter.reference }));
  return (produces, send, mark) =>
    functionType({
      send,
      mark,
      parameters: slots,
      pack: rest?.type,
      result: headResult(context.checker.fitting, node.qualifiers, mark, produces),
    });
}

/** `parameter` with its types as `solved` settles them. */
function settledParameter(
  parameter: SignatureParameter,
  solved: (type: Type) => Type,
): SignatureParameter {
  const { rest } = parameter;
  return {
    ...parameter,
    type: solved(parameter.type),
    rest: rest?.kind === 'array' ? { kind: 'array', item: solved(rest.item) } : rest,
  };
}

/** The kind of a nested function as a value, checked in `scope`, given `given` if any. */
function nestedValueKind(
  node: NestedFunction,
  given: Type | undefined,
  scope: FunctionScope,
): Type {
  if (given !== undefined) {
    return given;
  }
  return awaits(node.qualifiers) || scope.reliesOnKind ? scope.codeKind : simpleMark;
}

/**
 * Records `checked`, a nested function checked in its `scope`, as giving `produces`, its parameters'
 * types as `solved` settles them, with what it captures and the sendability that allows (§3.14),
 * and declares it under its name, if it has one; its type.
 */
export function recordedNested(
  context: BodyContext,
  checked: {
    readonly node: NestedFunction;
    readonly name: Identifier | undefined;
    readonly parameters: readonly SignatureParameter[];
    readonly givenKind: Type | undefined;
    readonly scope: FunctionScope;
  },
  produces: Type,
  solved: (type: Type) => Type = (open) => open,
): FunctionType {
  const { node, name, scope, givenKind } = checked;
  const parameters = checked.parameters.map((parameter) => settledParameter(parameter, solved));
  const captures = capturesOf(context, scope);
  const send = capturedSend(
    context.checker,
    captures.map((capture) =>
      context.variables.isChangeable(capture.entity)
        ? cellTypeOf(context.checker, capture.type)
        : capture.type,
    ),
  );
  const kind = nestedValueKind(node, givenKind, scope);
  const recorded = nestedTypeOf(context, node, parameters)(produces, send, kind);
  if (name !== undefined) {
    context.variables.declare(name, recorded);
  }
  context.functions.record(node, { type: recorded, result: produces, parameters, captures });
  return recorded;
}
