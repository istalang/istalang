/**
 * Building structs and reading their fields (§3.1).
 *
 * - A struct literal names its type, or with `struct{…}` takes it: from the expected type when
 *   that is a struct, else from a leading spread's value, else it is a fresh anonymous struct
 *   whose fields are the named items, each typed by its value.
 * - Its items are checked by the path variants share (literal-fields.ts), so a generic struct's
 *   type arguments are written, expected, spread or inferred alike. A literal naming a variant
 *   builds that variant (variants.ts).
 * - A struct without fields is written bare (names.ts), so braces after one are an error, whatever
 *   they hold.
 * - Reading `s.f` gives the field's type, substituted for the struct's type arguments; through a
 *   type parameter, a field a constraint requires (§3.10). A member that isn't a field is
 *   reported as unknown here; a call of one is a method call (calls.ts).
 */

import { itemValue, type MemberAccess, type StructLiteral } from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { FieldSource } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { typeArgumentsFor } from '../declarations/resolve-type.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { staticCandidates } from '../overloads/candidates.ts';
import { staticTargetOf } from '../traits/conformance.ts';
import { requiredFields, requiredFieldType } from '../traits/constraints.ts';
import { errorType, type FieldMember, type NominalType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { checkLiteralFields, type LiteralShape, type LiteralSpread } from './literal-fields.ts';
import { entityValueType } from './names.ts';
import { checkVariantLiteral, checkVariantName, namedType } from './variants.ts';

export function checkStructLiteral(
  context: BodyContext,
  node: StructLiteral,
  expected: Type | undefined,
): Type {
  const typeNode = node.type;
  const [first] = node.items;
  const spread = first?.kind === 'Spread' ? { node: first } : undefined;
  if (typeNode === undefined) {
    return checkAnonymousLiteral(context, node, expected, spread);
  }
  const name = lastName(typeNode.path);
  const entity = context.entityOf(name);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    return checkVariantLiteral(context, node, entity, expected);
  }
  if (entity === undefined) {
    return errorType;
  }
  const declaration =
    entity.kind === 'type' && entity.declaration.kind === 'StructDeclaration'
      ? entity.declaration
      : undefined;
  if (declaration === undefined) {
    context.report(checkerDiagnostics.notStruct(typeNode.span, name.text));
    return errorType;
  }
  const known = knownArguments(context, typeNode, declaration, expected);
  const shape = declaredShape(context, entity as NominalType['entity'], known);
  if (shape.fields.length === 0) {
    context.report(checkerDiagnostics.bareStruct(node.span, name.text));
    checkValuesAlone(context, node);
    return shape.typeOf([]);
  }
  return checkLiteralFields(context, node, shape, spread);
}

/** `struct{…}`: the expected struct, a leading spread's struct, or else a fresh anonymous struct. */
function checkAnonymousLiteral(
  context: BodyContext,
  node: StructLiteral,
  expected: Type | undefined,
  spread: LiteralSpread | undefined,
): Type {
  const fromExpected = expected === undefined ? undefined : shapeOf(context, expected);
  if (fromExpected !== undefined) {
    return checkLiteralFields(context, node, fromExpected, spread);
  }
  if (spread === undefined) {
    return freshAnonymous(context, node);
  }
  const type = context.expression(spread.node.expression);
  const fromSpread = shapeOf(context, type);
  if (fromSpread === undefined) {
    if (type.kind !== 'error') {
      context.report(checkerDiagnostics.notStructValue(spread.node.span, typeText(type)));
    }
    checkValuesAlone(context, node);
    return errorType;
  }
  return checkLiteralFields(context, node, fromSpread, { ...spread, type });
}

/** How a literal builds a value of `type`, a struct type, with its type arguments; else undefined. */
function shapeOf(context: BodyContext, type: Type): LiteralShape | undefined {
  if (type.kind === 'anonymous') {
    return { owner: undefined, known: undefined, fields: type.fields, typeOf: () => type };
  }
  if (type.kind === 'nominal' && type.entity.declaration.kind === 'StructDeclaration') {
    return declaredShape(context, type.entity, type.arguments);
  }
  return undefined;
}

/** How a literal builds the declared struct `entity` names, from its declared fields. */
function declaredShape(
  context: BodyContext,
  entity: NominalType['entity'],
  known: readonly Type[] | undefined,
): LiteralShape {
  const { declaration } = entity;
  return {
    owner: declaration.kind === 'ExternStructDeclaration' ? undefined : declaration,
    known,
    fields:
      declaration.kind === 'StructDeclaration' ? context.checker.declaredFieldsOf(declaration) : [],
    typeOf: (typeArguments) => ({ kind: 'nominal', entity, arguments: typeArguments }),
  };
}

/**
 * A `struct{…}` with nothing to take a type from: a type of its own, typed by its values. Only
 * named items can name its fields.
 */
function freshAnonymous(context: BodyContext, node: StructLiteral): Type {
  const fields: FieldMember[] = [];
  const sources: FieldSource[] = [];
  let fits = true;
  for (const item of node.items) {
    if (item.kind === 'FieldInitializer') {
      const value = itemValue(item);
      const type = context.expression(value);
      if (fields.some((field) => field.name === item.name.text)) {
        context.report(checkerDiagnostics.repeatedField(item.name.span, item.name.text));
        fits = false;
      } else {
        fields.push({ name: item.name.text, type });
        sources.push({ kind: 'value', value });
      }
    } else if (item.kind !== 'Invalid') {
      context.report(checkerDiagnostics.unnamedAnonymousField(item.span));
      context.expression(item.kind === 'Spread' ? item.expression : item.value);
      fits = false;
    }
  }
  if (fits) {
    context.literals.record(node, sources);
  }
  return { kind: 'anonymous', origin: node, fields };
}

/** Checks every value of a literal whose type is unknown, so each is still recorded. */
function checkValuesAlone(context: BodyContext, node: StructLiteral): void {
  for (const item of node.items) {
    if (item.kind === 'Spread') {
      context.expression(item.expression);
    } else if (item.kind !== 'Invalid') {
      context.expression(itemValue(item));
    }
  }
}

/** The type arguments a struct literal is given: written, or those of the expected type. */
function knownArguments(
  context: BodyContext,
  typeNode: NamedType,
  declaration: NominalType['entity']['declaration'],
  expected: Type | undefined,
): readonly Type[] | undefined {
  if (typeNode.typeArguments.length > 0) {
    const written = typeNode.typeArguments.map((argument) => context.resolveType(argument));
    return typeArgumentsFor(context.checker, context.module, {
      at: typeNode.span,
      declaration,
      types: written,
    });
  }
  return expected?.kind === 'nominal' && expected.entity.declaration === declaration
    ? expected.arguments
    : undefined;
}

export function checkMemberAccess(
  context: BodyContext,
  node: MemberAccess,
  expected: Type | undefined,
): Type {
  if (node.isOptional) {
    return context.unsupported(node, frontier.optionalChaining);
  }
  const qualified = context.entityOf(node.member);
  if (qualified?.kind === 'variant') {
    return checkVariantName(context, node, qualified, expected);
  }
  if (qualified !== undefined) {
    return entityValueType(context, node.member, qualified, expected);
  }
  const owner = namedType(context, node.target);
  if (owner !== undefined) {
    return staticMember(context, node, owner);
  }
  const type = context.expression(node.target);
  if (type.kind === 'error') {
    return errorType;
  }
  const field = fieldOf(context, type, node.member.text);
  if (field === undefined) {
    context.report(
      checkerDiagnostics.unknownField(node.member.span, typeText(type), node.member.text),
    );
    return errorType;
  }
  return field;
}

/**
 * A static function named as a value through its type, which function values add; a name its
 * type has no static function of is reported here.
 */
function staticMember(context: BodyContext, node: MemberAccess, owner: Type): Type {
  const { checker, module } = context;
  const target = staticTargetOf(checker, owner);
  const found =
    target !== undefined && staticCandidates(checker, module, target, node.member.text).length > 0;
  if (!found) {
    context.report(
      checkerDiagnostics.noStaticFunction(node.member.span, typeText(owner), node.member.text),
    );
    return errorType;
  }
  return context.unsupported(node, frontier.staticMember);
}

/** The type of the field `name` of `type`, through a constraint for a type parameter. */
function fieldOf(context: BodyContext, type: Type, name: string): Type | undefined {
  const { checker } = context;
  if (type.kind === 'nominal' || type.kind === 'anonymous') {
    return checker.fieldsOf(type)?.find((candidate) => candidate.name === name)?.type;
  }
  if (type.kind !== 'parameter' || type.declaration.kind !== 'TypeParameter') {
    return undefined;
  }
  for (const constraint of checker.constraintsOf(type.declaration)) {
    const field = requiredFields(constraint.trait).find((each) => each.name.text === name);
    if (field !== undefined) {
      return requiredFieldType(checker, constraint, field, type);
    }
  }
  return undefined;
}
