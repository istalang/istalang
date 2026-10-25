/**
 * Building structs and reading their fields (§3.1). A literal's values are evaluated in source
 * order and stored in its type's declaration order, each field from where the checker recorded it
 * comes from (`sourcesOf`); a field the literal doesn't give is read from its leading spread,
 * evaluated once. A field read names the field by its index.
 */

import type { Register } from '../../../definition/operands.ts';
import type { AnonymousStructType, NominalType } from '../../checker/types/type.ts';
import {
  type Expression,
  itemValue,
  type MemberAccess,
  type StructLiteral,
} from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { fieldIndexOf } from '../places.ts';

export function lowerStructLiteral(context: FunctionContext, node: StructLiteral): Register {
  return construct(context, structTypeOf(context, node), literalFields(context, node), node.span);
}

/**
 * The registers of a struct or variant literal's fields, in declaration order: its values evaluated
 * in source order, then each field taken from its value or read from the spread.
 */
export function literalFields(context: FunctionContext, node: StructLiteral): Register[] {
  const sources = context.body.sourcesOf(node);
  if (sources === undefined) {
    throw new Error(
      `A struct literal misses a field at ${node.span.start}; the checker should have said so.`,
    );
  }
  const values = new Map<Expression, Register>();
  for (const item of node.items) {
    if (item.kind !== 'Invalid') {
      const value = item.kind === 'Spread' ? item.expression : itemValue(item);
      values.set(value, context.expression(value));
    }
  }
  return sources.map((source) => {
    if (source.kind === 'value') {
      return registerOf(values, source.value);
    }
    const dst = context.code.allocate();
    const src = registerOf(values, source.from);
    context.code.emit({ kind: 'field', span: node.span, dst, src, index: source.index });
    return dst;
  });
}

/** A struct without fields, written bare (§3.1). */
export function lowerBareStruct(context: FunctionContext, node: Expression): Register {
  return construct(context, structTypeOf(context, node), [], node.span);
}

export function lowerFieldRead(context: FunctionContext, node: MemberAccess): Register {
  const src = context.expression(node.target);
  const dst = context.code.allocate();
  const index = fieldIndexOf(context, node);
  context.code.emit({ kind: 'field', span: node.span, dst, src, index });
  return dst;
}

/** Builds a struct of `type` from `fields`, in declaration order. */
export function construct(
  context: FunctionContext,
  type: NominalType | AnonymousStructType,
  fields: readonly Register[],
  span: StructLiteral['span'],
): Register {
  const dst = context.code.allocate();
  const index = context.tables.typeIndex(type);
  context.code.emit({ kind: 'struct', span, dst, type: index, fields: [...fields] });
  return dst;
}

/** The struct type the checker gave `node`, declared or anonymous. */
function structTypeOf(
  context: FunctionContext,
  node: Expression,
): NominalType | AnonymousStructType {
  const type = context.body.typeOf(node);
  if (type.kind !== 'nominal' && type.kind !== 'anonymous') {
    throw new Error(`Expected a struct at ${node.span.start}; the checker should have said so.`);
  }
  return type;
}

function registerOf(values: ReadonlyMap<Expression, Register>, value: Expression): Register {
  const register = values.get(value);
  if (register === undefined) {
    throw new Error(`No value was lowered for the item at ${value.span.start}.`);
  }
  return register;
}
