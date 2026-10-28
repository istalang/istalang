/**
 * Building structs and reading their fields (§3.1). A literal's values are evaluated in source
 * order and stored in its type's declaration order, each field from where the checker recorded it
 * comes from (`sourcesOf`); a field the literal doesn't give is read from its leading spread,
 * evaluated once, or else computed by the call to its default the checker recorded, given the
 * fields before it, in declaration order. A field read names the field by its index.
 *
 * `new X{…}` builds the value behind a shared struct the same way, as the anonymous struct its
 * fields make, and puts it in a new cell, whose handle is the shared struct's value (§3.18).
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
} from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import { defaultEntryOf } from '../instances.ts';

export function lowerStructLiteral(context: FunctionContext, node: StructLiteral): Register {
  const type = structTypeOf(context, node);
  const fields = literalFields(context, node);
  const sharedValue = context.checker.sharedValueOf(type);
  if (sharedValue === undefined) {
    return construct(context, type, fields, node.span);
  }
  const value = construct(context, sharedValue, fields, node.span);
  const dst = context.code.allocate();
  const cellType = context.tables.types.index(type);
  context.code.emit({ kind: 'newCell', span: node.span, dst, type: cellType, value });
  return dst;
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
    case 'spread':
      return context.code.field(registerOf(values, source.from), source.index, node.span);
    case 'default': {
      const fields = context.closed(source.call);
      if (fields.kind !== 'function') {
        unreachable('A field default is computed by its fields function, never a dispatch.');
      }
      return emitCall(context, {
        span: node.span,
        callee: context.tables.functionIndex(defaultEntryOf(fields, earlier.length)),
        arguments: [...earlier],
      });
    }
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

/** Whether `a.b` reads a field, rather than naming a namespace's or a type's member (names.ts). */
export function readsField(context: FunctionContext, access: MemberAccess): boolean {
  return context.entityOf(access.member) === undefined;
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
  const read = context.body.fieldReadOf(node);
  switch (read.kind) {
    case 'position':
      return context.code.field(src, read.index, node.span);
    case 'dispatch': {
      const callee = context.tables.anyFieldIndex(read.on, read.required);
      return emitCall(context, { span: node.span, callee, arguments: [src] });
    }
    case 'required':
      return unreachable('An instantiated body reads no field through a type parameter.');
    default: {
      const unhandled: never = read;
      return unhandled;
    }
  }
}

/** Builds a struct of `type` from `fields`, in declaration order. */
export function construct(
  context: FunctionContext,
  type: NominalType | AnonymousStructType,
  fields: readonly Register[],
  span: StructLiteral['span'],
): Register {
  const dst = context.code.allocate();
  const index = context.tables.types.index(type);
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
