/**
 * Building structs and reading their fields (§3.1). A literal's values are evaluated in source
 * order, then each field taken from where the checker recorded it comes from (`sourcesOf`), in
 * declaration order: a field the literal doesn't give is read from its leading spread, evaluated
 * once, or else computed by the call to its default the checker recorded, given the fields before
 * it. A struct is then built by its fields' names into its type's layout, name order (§3.1 "Field
 * order", `laidOut`), so nothing that builds one depends on the order it has its values in. A
 * field read names the field by its index.
 *
 * `new X{…}` builds the value behind a shared struct the same way, as the shape its fields make,
 * and puts it in a new cell, whose handle is the shared struct's value (§3.18).
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { FieldSource } from '../../checker/check.ts';
import { laidOut, namedValues } from '../../checker/types/field-order.ts';
import type {
  AnonymousStructType,
  NominalType,
  StructValueType,
} from '../../checker/types/type.ts';
import {
  type Expression,
  type FieldsLiteral,
  itemValue,
  type MemberAccess,
  type NewStructLiteral,
  type StructLiteral,
} from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import { defaultEntryOf } from '../closed-calls.ts';
import type { CodeContext, FunctionContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';

export function lowerStructLiteral(context: FunctionContext, node: StructLiteral): Register {
  const fields = namedFields(literalFields(context, node));
  return construct(context, structTypeOf(context, node), fields, node.span);
}

export function lowerNewStructLiteral(context: FunctionContext, node: NewStructLiteral): Register {
  const type = structTypeOf(context, node);
  const sharedValue = context.checker.sharedValueOf(type);
  if (sharedValue === undefined) {
    unreachable(
      `'new' at ${node.span.from} builds no shared struct; the checker should have said so.`,
    );
  }
  const value = construct(
    context,
    sharedValue,
    namedFields(literalFields(context, node)),
    node.span,
  );
  const dst = context.code.allocate();
  const cellType = context.tables.types.index(type);
  context.code.emit({ kind: 'newCell', span: node.span, dst, type: cellType, value });
  return dst;
}

/** A literal's field, by its name, and the register holding its value. */
interface LiteralField {
  readonly field: string;
  readonly register: Register;
}

/**
 * The registers of a struct or variant literal's fields, in declaration order: its values evaluated
 * in source order, then each field taken from its value, read from the spread, or computed by its
 * default.
 */
export function literalFields(context: FunctionContext, node: FieldsLiteral): LiteralField[] {
  const sources = context.body.sourcesOf(node);
  if (sources === undefined) {
    unreachable(
      `A struct literal misses a field at ${node.span.from}; the checker should have said so.`,
    );
  }
  const values = new Map<Expression, Register>();
  for (const item of node.items) {
    if (item.kind !== 'Invalid') {
      const value = item.kind === 'Spread' ? item.expression : itemValue(item);
      values.set(value, context.expression(value));
    }
  }
  const fields: LiteralField[] = [];
  for (const source of sources) {
    const earlier = fields.map(({ register }) => register);
    fields.push({
      field: source.field,
      register: fieldOf(context, { node, values }, source, earlier),
    });
  }
  return fields;
}

function namedFields(fields: readonly LiteralField[]): ReadonlyMap<string, Register> {
  return new Map(fields.map(({ field, register }) => [field, register]));
}

/** A literal with its items' values evaluated, which its fields are taken from. */
interface EvaluatedLiteral {
  readonly node: FieldsLiteral;
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
  return construct(context, structTypeOf(context, node), new Map(), node.span);
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
  const read = context.fieldReadOf(node);
  switch (read.kind) {
    case 'position':
      return context.code.field(src, read.index, node.span);
    case 'dispatch': {
      const callee = context.tables.anyFieldIndex(read.on, read.required);
      return emitCall(context, { span: node.span, callee, arguments: [src] });
    }
    case 'required':
    case 'named':
      return unreachable("An instantiated body reads no field of a type it doesn't know.");
    case 'keyed':
      return unreachable('A field read by name is no read by a key.');
    default: {
      const unhandled: never = read;
      return unhandled;
    }
  }
}

/** Builds a struct of `type`, each of its fields taken by its name from `named`. */
export function construct(
  context: CodeContext,
  type: NominalType | AnonymousStructType,
  named: ReadonlyMap<string, Register>,
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
  const index = context.tables.types.index(type);
  const fields = laidOut(context.checker.fieldsOf(type) ?? [], named);
  context.code.emit({ kind: 'struct', span, dst, type: index, fields });
  return dst;
}

/**
 * `value`, a struct of `from`, built anew as a struct of `to`, each field taken by its name: a
 * nominal struct's value as its shape (§3.1).
 */
export function rebuiltAs(
  context: FunctionContext,
  value: Register,
  { from, to }: { readonly from: StructValueType; readonly to: StructValueType },
  span: AnchoredSpan,
): Register {
  const fields = context.checker.fieldsOf(from) ?? [];
  const values = fields.map((_, index) => context.code.field(value, index, span));
  return construct(context, to, namedValues(fields, values), span);
}

/** The struct type the checker gave `node`, declared or anonymous. */
function structTypeOf(
  context: FunctionContext,
  node: Expression,
): NominalType | AnonymousStructType {
  const type = context.typeOf(node);
  if (type.kind !== 'nominal' && type.kind !== 'anonymous') {
    unreachable(`Expected a struct at ${node.span.from}; the checker should have said so.`);
  }
  return type;
}

function registerOf(values: ReadonlyMap<Expression, Register>, value: Expression): Register {
  const register = values.get(value);
  if (register === undefined) {
    unreachable(`No value was lowered for the item at ${value.span.from}.`);
  }
  return register;
}
