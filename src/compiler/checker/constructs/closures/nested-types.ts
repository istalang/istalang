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
import type { SignatureParameter } from '../../check.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { heldKindRefusal } from '../../rules/kinds/signature-kinds.ts';
import type { NestedFunction } from '../../surface/checked-body.ts';
import { isMarkVariable, simpleMark, writtenKindOf } from '../../types/type/function-kinds.ts';
import { functionType, headResult } from '../../types/type/function-types.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import type { FunctionScope } from './function-scope.ts';

/**
 * The kind a nested function's head or position gives it: its head's, else `expected`, the kind of
 * the function type expected of it, where that is a literal mark or a mark parameter fixed around
 * it (`logged`'s `M` in its own body); never a call's variable still `open`, which its body infers.
 * Undefined where neither does.
 */
export function givenKindOf(
  qualifiers: FunctionQualifiers,
  expected?: Type,
  open?: (type: Type) => boolean,
): Type | undefined {
  const known =
    expected !== undefined &&
    (expected.kind === 'literal' || (isMarkVariable(expected) && open?.(expected) === false))
      ? expected
      : undefined;
  return writtenKindOf(qualifiers) ?? known;
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

/** The kind of a nested function as a value, checked in `scope`, given `given` if any. */
export function nestedValueKind(
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
 * Reports what `type`, the type of the nested function `node`, holds of a kind its own refuses,
 * as a declared function's signature is judged (rules/kinds/signature-kinds.ts).
 */
export function judgeHeldKinds(
  context: BodyContext,
  node: NestedFunction,
  type: FunctionType,
): void {
  const at = node.span;
  const { checker, module } = context;
  // An async head's written `Future<…>` is what its call gives, read as written
  // (signature-kinds.ts).
  const written =
    awaits(node.qualifiers) && node.returnType !== undefined
      ? [{ at, type: checker.resolveType(module, node.returnType) }]
      : [];
  const refusal = heldKindRefusal(checker, {
    own: type.mark,
    holder: node.kind === 'Lambda' ? 'a lambda' : `'${node.name.text}'`,
    held: [
      ...type.parameters.map((slot) => ({ at, type: slot.type })),
      { at, type: type.result },
      ...written,
    ],
  });
  if (refusal !== undefined) {
    context.report(refusal);
  }
}
