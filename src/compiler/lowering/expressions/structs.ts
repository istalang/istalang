/**
 * Building structs and reading their fields (§3.1). A literal's values are evaluated in source
 * order and stored in its type's declaration order, each field from where the checker recorded it
 * comes from (`sourcesOf`); a field the literal doesn't give is read from its leading spread,
 * evaluated once, or else computed by the call to its default the checker recorded, given the
 * fields before it, in declaration order. A field read names the field by its index.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { FieldSource } from '../../checker/check.ts';
import type { AnonymousStructType, NominalType } from '../../checker/types/type.ts';
import {
  type Expression,
  itemValue,
  type MemberAccess,
  type StructLiteral,
} from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import { fieldIndexOf } from '../places.ts';

export function lowerStructLiteral(context: FunctionContext, node: StructLiteral): Register {
  return construct(context, structTypeOf(context, node), literalFields(context, node), node.span);
}

/**
 * The registers of a struct or variant literal's fields, in declaration order: its values evaluated
 * in source order, then each field taken from its value, read from the spread, or computed by its
 * default.
 */
export function literalFields(context: FunctionContext, node: StructLiteral): Register[] {
  const sources = context.body.sourcesOf(node);
  if (sources === undefined) {
    unreachable(
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
  const fields: Register[] = [];
  for (const source of sources) {
    fields.push(fieldOf(context, { node, values }, source, fields));
  }
  return fields;
}

/** A literal with its items' values evaluated, which its fields are taken from. */
interface EvaluatedLiteral {
  readonly node: StructLiteral;
  readonly values: ReadonlyMap<Expression, Register>;
}

/** The register of `literal`'s field from `source`, after the fields `earlier`. */
function fieldOf(
  context: FunctionContext,
  { node, values }: EvaluatedLiteral,
  source: FieldSource,
  earlier: readonly Register[],
): Register {
  switch (source.kind) {
    case 'value':
      return registerOf(values, source.value);
    case 'spread': {
      const dst = context.code.allocate();
      const src = registerOf(values, source.from);
      context.code.emit({ kind: 'field', span: node.span, dst, src, index: source.index });
      return dst;
    }
    case 'default':
      return emitCall(context, {
        span: node.span,
        callee: context.callIndex(source.call),
        arguments: [...earlier],
      });
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}

/** A struct without fields, written bare (§3.1). */
export function lowerBareStruct(context: FunctionContext, node: Expression): Register {
  return construct(context, structTypeOf(context, node), [], node.span);
}

/**
 * `x.f`, read from the value its chain link works on: the access itself, or the call `x.f(…)` of
 * a function-typed field, which is the link instead (calls.ts).
 */
export function lowerFieldRead(
  context: FunctionContext,
  node: MemberAccess,
  link: Expression = node,
): Register {
  const src = context.chains.target(context, link);
  const dst = context.code.allocate();
  const index = fieldIndexOf(context, node, link);
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
    unreachable(`Expected a struct at ${node.span.start}; the checker should have said so.`);
  }
  return type;
}

function registerOf(values: ReadonlyMap<Expression, Register>, value: Expression): Register {
  const register = values.get(value);
  if (register === undefined) {
    unreachable(`No value was lowered for the item at ${value.span.start}.`);
  }
  return register;
}
