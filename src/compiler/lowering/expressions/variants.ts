/**
 * Enum variants as values (§3.11): `variant` of the enum type the checker gave the expression,
 * by the variant's index, fields in declaration order. `none` is `Optional`'s `None`.
 */

import type { Register } from '../../../definition/operands.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import type { Checker } from '../../checker/check.ts';
import type { NominalType, Type } from '../../checker/types/type.ts';
import type { Expression, StructLiteral } from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import type { FunctionContext } from '../context.ts';
import { literalFields } from './structs.ts';

/** The index of the variant `name` of the enum `type`. */
export function variantIndexOf(checker: Checker, type: NominalType, name: string): number {
  const index = (checker.variantsOf(type) ?? []).findIndex((variant) => variant.name === name);
  if (index < 0) {
    throw new Error(`No variant '${name}'; the checker should have said so.`);
  }
  return index;
}

/** A variant without fields, named bare, qualified, or as `none`. */
export function lowerFieldlessVariant(
  context: FunctionContext,
  node: Expression,
  name: string,
): Register {
  return emitVariant(context, node, name, []);
}

export function lowerNone(context: FunctionContext, node: Expression): Register {
  return lowerFieldlessVariant(context, node, optionalVariants.none);
}

/** `Rejected{by: "legal"}`: built from the same fields as a struct literal (structs.ts). */
export function lowerVariantLiteral(context: FunctionContext, node: StructLiteral): Register {
  const name = node.type === undefined ? '' : lastName(node.type.path).text;
  return emitVariant(context, node, name, literalFields(context, node));
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
  const type = context.body.typeOf(node);
  if (!isEnum(type)) {
    throw new Error(`Expected an enum at ${node.span.start}; the checker should have said so.`);
  }
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'variant',
    span: node.span,
    dst,
    type: context.tables.typeIndex(type),
    variant: variantIndexOf(context.checker, type, name),
    fields: [...fields],
  });
  return dst;
}
