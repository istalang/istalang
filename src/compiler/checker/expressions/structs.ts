/**
 * Building structs and reading their fields (§3.1).
 *
 * A struct literal names its type and gives every field exactly once, each value fitting the
 * field's type. Reading `s.f` gives the field's type, substituted for the struct's type arguments.
 *
 * The other literal forms (shorthand, positional, spread, `struct{…}`), generic literals whose
 * arguments would be inferred, and enum variants are reported as not supported until the features
 * that add them. A member that isn't a field, such as a method, is reported as unknown.
 */

import type { MemberAccess, StructLiteral } from '../../syntax/expressions.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { FieldMember } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { entityValueType } from './names.ts';

export function checkStructLiteral(context: BodyContext, node: StructLiteral): Type {
  const typeNode = node.type;
  if (typeNode === undefined) {
    return context.unsupported(node, "A 'struct{…}' literal");
  }
  const type = literalType(context, node, typeNode);
  if (type.kind === 'error') {
    return type;
  }
  const fields = type.kind === 'nominal' ? context.checker.fieldsOf(type) : undefined;
  if (fields === undefined) {
    const name = typeNode.path.at(-1) ?? typeNode.path[0];
    context.report(checkerDiagnostics.notStruct(typeNode.span, name.text));
    return errorType;
  }
  const given = new Set<string>();
  for (const item of node.items) {
    checkItem(context, item, { type, fields, given });
  }
  for (const field of fields.filter((candidate) => !given.has(candidate.name))) {
    context.report(checkerDiagnostics.missingField(typeNode.span, typeText(type), field.name));
  }
  return type;
}

/** The type a literal names: a nominal type, or the error type after a report. */
function literalType(context: BodyContext, node: StructLiteral, typeNode: NamedType): Type {
  const entity = context.entityOf(typeNode.path.at(-1) ?? typeNode.path[0]);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    return context.unsupported(node, 'An enum variant');
  }
  const declaration = entity?.kind === 'type' ? entity.declaration : undefined;
  if (
    declaration?.kind === 'StructDeclaration' &&
    declaration.typeParameters.length > typeNode.typeArguments.length
  ) {
    return context.unsupported(node, 'Inferring type arguments');
  }
  return context.resolveType(typeNode);
}

interface LiteralFields {
  readonly type: Type;
  readonly fields: readonly FieldMember[];
  /** The fields given so far, so a repeat is caught. */
  readonly given: Set<string>;
}

/** Checks one item of a literal against the struct's fields. */
function checkItem(
  context: BodyContext,
  item: StructLiteral['items'][number],
  literal: LiteralFields,
): void {
  if (item.kind === 'Invalid') {
    return;
  }
  if (item.kind !== 'FieldInitializer' || item.value === undefined) {
    context.unsupported(item, item.kind === 'FieldInitializer' ? 'A shorthand field' : undefined);
    return;
  }
  const { type, fields, given } = literal;
  const field = fields.find((candidate) => candidate.name === item.name.text);
  if (field === undefined || given.has(field.name)) {
    context.report(
      field === undefined
        ? checkerDiagnostics.unknownField(item.name.span, typeText(type), item.name.text)
        : checkerDiagnostics.repeatedField(item.name.span, field.name),
    );
    context.expression(item.value);
    return;
  }
  given.add(field.name);
  context.expect(item.value, field.type);
}

export function checkMemberAccess(context: BodyContext, node: MemberAccess): Type {
  if (node.isOptional) {
    return context.unsupported(node, "The '?.' operator");
  }
  const qualified = context.entityOf(node.member);
  if (qualified !== undefined) {
    return entityValueType(context, node.member, qualified);
  }
  if (node.target.kind === 'Identifier') {
    const target = context.entityOf(node.target);
    if (target?.kind === 'type' || target?.kind === 'primitive') {
      return context.unsupported(node, 'A static member');
    }
  }
  const type = context.expression(node.target);
  if (type.kind === 'error') {
    return errorType;
  }
  const field =
    type.kind === 'nominal'
      ? context.checker.fieldsOf(type)?.find((candidate) => candidate.name === node.member.text)
      : undefined;
  if (field === undefined) {
    context.report(
      checkerDiagnostics.unknownField(node.member.span, typeText(type), node.member.text),
    );
    return errorType;
  }
  return field.type;
}
