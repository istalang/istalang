/**
 * Building structs and reading their fields (§3.1): a literal's fields are evaluated in source
 * order and stored in the type's declaration order; a field read names the field by its index.
 */

import type { Register } from '../../../definition/operands.ts';
import type { CheckedBody, Checker } from '../../checker/check.ts';
import type { NominalType } from '../../checker/types/type.ts';
import type { Expression, MemberAccess, StructLiteral } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { notLowered } from '../not-lowered.ts';

export function lowerStructLiteral(context: FunctionContext, node: StructLiteral): Register {
  const type = nominalTypeOf(context.body, node);
  const given = new Map<string, Register>();
  for (const item of node.items) {
    if (item.kind !== 'FieldInitializer' || item.value === undefined) {
      return notLowered(context, item);
    }
    given.set(item.name.text, context.expression(item.value));
  }
  const fields = inDeclarationOrder(context.checker, type, given);
  const dst = context.code.allocate();
  context.code.emit({
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
  const type = nominalTypeOf(context.body, node.target);
  const index = (context.checker.fieldsOf(type) ?? []).findIndex(
    (field) => field.name === node.member.text,
  );
  if (index < 0) {
    throw new Error(`No field '${node.member.text}'; the checker should have said so.`);
  }
  const dst = context.code.allocate();
  context.code.emit({ kind: 'field', span: node.span, dst, src, index });
  return dst;
}

/** What a literal gave each field of `type`, by name, in the type's declaration order. */
export function inDeclarationOrder<Field>(
  checker: Checker,
  type: NominalType,
  given: ReadonlyMap<string, Field>,
): Field[] {
  return (checker.fieldsOf(type) ?? []).map((field) => {
    const value = given.get(field.name);
    if (value === undefined) {
      throw new Error(`No value for '${field.name}'; the checker should have said so.`);
    }
    return value;
  });
}

/** The struct type the checker gave `node`. */
export function nominalTypeOf(body: CheckedBody, node: Expression): NominalType {
  const type = body.typeOf(node);
  if (type.kind !== 'nominal') {
    throw new Error(`Expected a struct at ${node.span.start}; the checker should have said so.`);
  }
  return type;
}
