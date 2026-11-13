/**
 * Building structs and reading their fields (§3.1). A literal's values are evaluated in source
 * order, then each field taken from where the checker recorded it comes from (`sourcesOf`), in
 * declaration order: a field the literal doesn't give is read from its leading spread, evaluated
 * once. A struct is then built by its fields' names into its type's layout, name order (§3.1
 * "Field order", `laidOut`), so nothing that builds one depends on the order it has its values in.
 * A literal leaving fields to their defaults instead calls its struct's entry with every field in
 * declaration order, those left out omitted, which computes them before building it, each seeing
 * the fields before it (functions/built-entries.ts). A field read names the field by its index.
 *
 * `new X{…}` builds the value behind a shared struct the same way, as the shape its fields make,
 * and puts it in a new cell, whose handle is the shared struct's value (§3.18).
 */

import type { Argument } from '../../../../../definition/instructions/places.ts';
import type { Register } from '../../../../../definition/operands.ts';
import { unreachable } from '../../../../../foundation/structures/unreachable.ts';
import type { FieldSource } from '../../../../checker/surface/checked-body.ts';
import type { FunctionCall } from '../../../../checker/surface/resolved-call.ts';
import type { AnonymousStructType, NominalType } from '../../../../checker/types/type/index.ts';
import type {
  Expression,
  FieldsLiteral,
  MemberAccess,
  StructComprehension,
} from '../../../../syntax/expressions/index.ts';
import { itemValue } from '../../../../syntax/expressions/readings.ts';
import { emitCall } from '../../../calls/emit-call.ts';
import type { FunctionContext } from '../../../context.ts';
import { construct, structValue } from '../../../values/struct-values.ts';
import { fieldsVisited, valueInFieldScope } from '../../loops/field-passes.ts';
import { readPartAlong } from '../../parts/part-paths.ts';

/**
 * The value `node` builds: its struct, a shared struct's in a new cell, built where it stands, or
 * by its struct's entry when it leaves fields to their defaults.
 */
export function lowerFieldsLiteral(context: FunctionContext, node: FieldsLiteral): Register {
  const { fields, defaults } = literalFields(context, node);
  const named = new Map(fields.map(({ field, register }) => [field, register]));
  if (defaults === undefined) {
    return structValue(context, structTypeOf(context, node), named, node.span);
  }
  const called = context.closed(defaults);
  if (called.kind !== 'function') {
    unreachable('A field default is computed by its fields function, never a dispatch.');
  }
  const { instance } = called;
  const given = context.checker
    .parametersOf(instance.declaration)
    .map(({ node: field }): Register | Argument => {
      const register = field.name === undefined ? undefined : named.get(field.name.text);
      return register ?? { kind: 'omitted' };
    });
  const callee = context.tables.functionIndex(instance);
  return emitCall(context, { span: node.span, callee, arguments: given });
}

/** A literal's field, by its name, and the register holding its value. */
interface LiteralField {
  readonly field: string;
  readonly register: Register;
}

/**
 * The registers of a struct literal's fields, in declaration order: its values evaluated in source
 * order, a struct comprehension last (§3.1), then each field taken from its value, read from the
 * spread, or given by the comprehension; and the call of its struct's fields function computing
 * the fields it leaves to their defaults, if any.
 */
function literalFields(
  context: FunctionContext,
  node: FieldsLiteral,
): { readonly fields: readonly LiteralField[]; readonly defaults: FunctionCall | undefined } {
  const sources = context.body.sourcesOf(node);
  if (sources === undefined) {
    unreachable(
      `A struct literal misses a field at ${node.span.from}; the checker should have said so.`,
    );
  }
  const values = new Map<Expression, Register>();
  let comprehended: readonly LiteralField[] = [];
  for (const item of node.items) {
    if (item.kind === 'StructComprehension') {
      comprehended = comprehendedFields(context, item);
    } else if (item.kind !== 'Invalid') {
      const value = item.kind === 'Spread' ? item.expression : itemValue(item);
      values.set(value, context.expression(value));
    }
  }
  const fields: LiteralField[] = [];
  let defaults: FunctionCall | undefined;
  for (const source of sources) {
    if (source.kind === 'comprehension') {
      fields.push(...comprehended);
    } else if (source.kind === 'default') {
      defaults = source.call;
    } else {
      fields.push({ field: source.field, register: fieldOf(context, { node, values }, source) });
    }
  }
  return { fields, defaults };
}

/**
 * The fields a struct comprehension gives (§3.1), one per field of its subject's struct, in name
 * order, each the value it gives in that field's pass (constructs/loops/field-passes.ts).
 */
function comprehendedFields(
  context: FunctionContext,
  node: StructComprehension,
): readonly LiteralField[] {
  const visited = fieldsVisited(context, node.header, node.span);
  return visited.fields.map((field, position) => ({
    field: field.name,
    register: valueInFieldScope(context, visited, position, () => context.expression(node.value)),
  }));
}

/** A literal with its items' values evaluated, which its fields are taken from. */
interface EvaluatedLiteral {
  readonly node: FieldsLiteral;
  readonly values: ReadonlyMap<Expression, Register>;
}

/** The register of `literal`'s field from `source`: its value, or the spread's field. */
function fieldOf(
  context: FunctionContext,
  { node, values }: EvaluatedLiteral,
  source: Extract<FieldSource, { readonly kind: 'value' | 'spread' }>,
): Register {
  if (source.kind === 'value') {
    return registerOf(values, source.value);
  }
  const step = { kind: 'field', of: context.typeOf(source.from), name: source.field } as const;
  return readPartAlong(context, registerOf(values, source.from), [step], node.span);
}

/** A struct without fields, written bare (§3.1). */
export function lowerBareStruct(context: FunctionContext, node: Expression): Register {
  return construct(context, structTypeOf(context, node), new Map(), node.span);
}

/**
 * Whether `a.b` reads a field, rather than naming a namespace's or a type's member
 * (../access/names.ts), a static function the checker resolved it to among them.
 */
export function readsField(context: FunctionContext, access: MemberAccess): boolean {
  return context.entityOf(access.member) === undefined && !context.body.resolved.has(access);
}

/**
 * `x.f`, read from the value its chain link works on: the access itself, or the call `x.f(…)` of
 * a function-typed field, which is the link instead (../calls.ts).
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
