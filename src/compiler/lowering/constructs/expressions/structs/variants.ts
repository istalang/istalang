/**
 * Enum variants as values (§3.11): of the enum type the checker gave the expression, built as
 * every variant is (values/variant-values.ts), and tested for by their index.
 */

import type { Register } from '../../../../../definition/operands.ts';
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../../checker/check.ts';
import type { NominalType, Type } from '../../../../checker/types/type/index.ts';
import type { Expression, StructLiteral } from '../../../../syntax/expressions/index.ts';
import { lastName } from '../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { CodeContext, FunctionContext } from '../../../context.ts';
import type { Label } from '../../../functions/code-writer.ts';
import { buildVariant, variantIndexOf } from '../../../values/variant-values.ts';
import { literalFields } from './structs.ts';

/** A variant without fields, named bare, qualified, or as `none`. */
export function lowerFieldlessVariant(
  context: FunctionContext,
  node: Expression,
  name: string,
): Register {
  return emitVariant(context, node, name, []);
}

/** `Rejected{by: "legal"}`: built from the same fields as a struct literal (structs.ts). */
export function lowerVariantLiteral(context: FunctionContext, node: StructLiteral): Register {
  const name = node.type === undefined ? '' : lastName(node.type.path).text;
  const fields = literalFields(context, node).map(({ register }) => register);
  return emitVariant(context, node, name, fields);
}

/** The enum value in `register` tested for one of its variants, the `variant`-th. */
export interface VariantTest {
  readonly register: Register;
  readonly variant: number;
}

/** The value of the enum `type` in `register`, tested for its variant `name`. */
function variantTestOf(
  checker: Checker,
  register: Register,
  type: NominalType,
  name: string,
): VariantTest {
  return { register, variant: variantIndexOf(checker, type, name) };
}

/** Jumps to `matched` when the value holds the variant tested, else to `otherwise`: a `switch`. */
export function branchOnVariant(
  context: CodeContext,
  test: VariantTest,
  labels: { readonly matched: Label; readonly otherwise: Label },
  span: AnchoredSpan,
): void {
  const targets = Array.from({ length: test.variant + 1 }, (_, index) =>
    index === test.variant ? labels.matched : labels.otherwise,
  );
  context.code.switch(test.register, targets, span, labels.otherwise);
}

/** The value a `Some`, `Ok` or `Err` in `register` holds: its one field (§3.11, §3.12). */
export function payloadOf(context: CodeContext, register: Register, span: AnchoredSpan): Register {
  return context.code.field(register, 0, span);
}

/** A value of the enum `type` in `register`, tested for its variant `name`, which has one field. */
export interface VariantCase {
  readonly register: Register;
  readonly type: NominalType;
  readonly name: string;
}

/**
 * Where `tested` holds its variant, continues with that variant's one field; else runs `otherwise`,
 * which writes what happens then and must leave the code: return, jump or panic.
 */
export function payloadOr(
  context: CodeContext,
  tested: VariantCase,
  otherwise: () => void,
  span: AnchoredSpan,
): Register {
  const { code } = context;
  const matched = code.newLabel();
  const unmatched = code.newLabel();
  const test = variantTestOf(context.checker, tested.register, tested.type, tested.name);
  branchOnVariant(context, test, { matched, otherwise: unmatched }, span);
  code.place(unmatched);
  otherwise();
  code.place(matched);
  return payloadOf(context, tested.register, span);
}

/** Whether `type` is an enum's, whose literals are its variants'. */
export function isEnum(type: Type): type is NominalType {
  return type.kind === 'nominal' && type.entity.declaration.kind === 'EnumDeclaration';
}

function emitVariant(
  context: FunctionContext,
  node: Expression,
  name: string,
  fields: readonly Register[],
): Register {
  const type = context.typeOf(node);
  if (!isEnum(type)) {
    unreachable(`Expected an enum at ${node.span.from}; the checker should have said so.`);
  }
  return buildVariant(context, { type, name }, fields, node.span);
}
