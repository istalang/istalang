/**
 * Enum variants as values (§3.11): `variant` of the enum type the checker gave the expression,
 * by the variant's index, fields in declaration order. `none` is `Optional`'s `None`.
 */

import type { Register } from '../../../definition/operands.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import type { Checker } from '../../checker/check.ts';
import type { NominalType } from '../../checker/types/type.ts';
import type { Expression, StructLiteral } from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import type { FunctionContext } from '../context.ts';
import { nominalTypeOf } from './structs.ts';

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

/** `Rejected{by: "legal"}`: fields evaluated in source order, stored in declaration order. */
export function lowerVariantLiteral(context: FunctionContext, node: StructLiteral): Register {
  const name = node.type === undefined ? '' : lastName(node.type.path).text;
  const given = new Map<string, Register>();
  for (const item of node.items) {
    if (item.kind === 'FieldInitializer' && item.value !== undefined) {
      given.set(item.name.text, context.expression(item.value));
    }
  }
  const type = nominalTypeOf(context.body, node);
  const variant = (context.checker.variantsOf(type) ?? []).find((each) => each.name === name);
  const fields = (variant?.fields ?? []).map((field) => {
    const register = given.get(field.name);
    if (register === undefined) {
      throw new Error(`No value for '${field.name}'; the checker should have said so.`);
    }
    return register;
  });
  return emitVariant(context, node, name, fields);
}

function emitVariant(
  context: FunctionContext,
  node: Expression,
  name: string,
  fields: readonly Register[],
): Register {
  const type = nominalTypeOf(context.body, node);
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
