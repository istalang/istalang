/**
 * Enum variants as values (§3.11): of the enum type the checker gave the expression, built as
 * every variant is (values/variant-values.ts), and tested for by their index.
 */

import type { Register } from '../../../../../definition/operands.ts';
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import { calledVariant } from '../../../../checker/surface/named-variants.ts';
import type { NominalType, Type } from '../../../../checker/types/type/index.ts';
import type { Call } from '../../../../syntax/expressions/calls.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../../syntax/tree/node.ts';
import type { FunctionContext } from '../../../context.ts';
import { buildVariant } from '../../../values/variant-values.ts';

/** A variant without fields, named bare or qualified. */
export function lowerFieldlessVariant(
  context: FunctionContext,
  node: Expression,
  name: string,
): Register {
  const type = context.typeOf(node);
  if (!isEnum(type)) {
    unreachable(`Expected an enum at ${node.span.from}; the checker should have said so.`);
  }
  return buildVariant(context, { type, name, fields: [] }, node.span);
}

/**
 * The variant without fields a call names, `Expired()`, which is its value (§3.11), as checking
 * chose it; undefined for any other call, a variant's with fields calling its constructor.
 */
export function fieldlessVariantCalled(context: FunctionContext, node: Call): string | undefined {
  const names = {
    entityOf: (name: Identifier) => context.entityOf(name),
    chosenVariantOf: (name: Identifier) => context.body.chosenVariantOf(name),
  };
  const variant = calledVariant(names, node)?.variant;
  return variant?.fields.length === 0 ? variant.name.text : undefined;
}

/** Whether `type` is an enum's, whose literals are its variants'. */
export function isEnum(type: Type): type is NominalType {
  return type.kind === 'nominal' && type.entity.declaration.kind === 'EnumDeclaration';
}
