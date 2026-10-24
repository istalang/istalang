/**
 * Building structs and reading their fields (§3.1): a literal's fields are evaluated in source
 * order and stored in the type's declaration order; a field read names the field by its index.
 */

import type { Register } from '../../../definition/operands.ts';
import type { NominalType } from '../../checker/types/type.ts';
import type { Expression, MemberAccess, StructLiteral } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { notLowered } from '../not-lowered.ts';

export function lowerStructLiteral(context: FunctionContext, node: StructLiteral): Register {
  const type = nominalTypeOf(context, node);
  const given = new Map<string, Register>();
  for (const item of node.items) {
    if (item.kind !== 'FieldInitializer' || item.value === undefined) {
      return notLowered(context, item);
    }
    given.set(item.name.text, context.expression(item.value));
  }
  const fields = (context.checker.fieldsOf(type) ?? []).map((field) => {
    const register = given.get(field.name);
    if (register === undefined) {
      throw new Error(`No value for '${field.name}'; the checker should have said so.`);
    }
    return register;
  });
  const dst = context.allocate();
  context.emit({
    kind: 'struct',
    span: node.span,
    dst,
    type: context.tables.typeIndex(type),
    fields,
  });
  return dst;
}

export function lowerFieldRead(context: FunctionContext, node: MemberAccess): Register {
  const src = context.expression(node.target);
  const type = nominalTypeOf(context, node.target);
  const index = (context.checker.fieldsOf(type) ?? []).findIndex(
    (field) => field.name === node.member.text,
  );
  if (index < 0) {
    throw new Error(`No field '${node.member.text}'; the checker should have said so.`);
  }
  const dst = context.allocate();
  context.emit({ kind: 'field', span: node.span, dst, src, index });
  return dst;
}

/** The struct type the checker gave `node`. */
export function nominalTypeOf(context: FunctionContext, node: Expression): NominalType {
  const type = context.body.typeOf(node);
  if (type.kind !== 'nominal') {
    throw new Error(`Expected a struct at ${node.span.start}; the checker should have said so.`);
  }
  return type;
}
