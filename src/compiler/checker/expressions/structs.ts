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

import { isMethod as isMethodDeclaration } from '../../syntax/declarations.ts';
import { fieldsFunctionOf } from '../../syntax/derived-functions.ts';
import { itemValue, type MemberAccess, type StructLiteral } from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import type { FieldSource } from '../check.ts';
import {
  checkFunctionValue,
  functionsAccepted,
  namedFunctions,
} from '../closures/function-values.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import type { Accepts } from '../resolution/choice.ts';
import { namedType } from '../resolution/named.ts';
import { requiredFields, requiredFieldType } from '../traits/constraints.ts';
import {
  errorType,
  type FieldMember,
  isNominalEntity,
  type NominalEntity,
  type Type,
} from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import {
  checkLiteralFields,
  knownArguments,
  type LiteralShape,
  type LiteralSpread,
} from './literal-fields.ts';
import { entityValueType } from './names.ts';
import { checkHandleValue } from './unwrap.ts';
import { checkVariantLiteral, checkVariantName, variantsAccepted } from './variants.ts';

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
  if (
    entity.kind !== 'type' ||
    !isNominalEntity(entity) ||
    entity.declaration.kind !== 'StructDeclaration'
  ) {
    context.report(checkerDiagnostics.notStruct(typeNode.span, name.text));
    return errorType;
  }
  const known = knownArguments(context, typeNode, entity.declaration, expected);
  const shape = declaredShape(context, entity, known);
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
  entity: NominalEntity,
  known: readonly Type[] | undefined,
): LiteralShape {
  const { declaration } = entity;
  const struct = declaration.kind === 'StructDeclaration' ? declaration : undefined;
  return {
    owner: struct,
    defaults: struct === undefined ? undefined : fieldsFunctionOf(struct),
    known,
    fields: struct === undefined ? [] : context.checker.declaredFieldsOf(struct),
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

export function checkMemberAccess(
  context: BodyContext,
  node: MemberAccess,
  expected: Type | undefined,
): Type {
  const qualified = node.isOptional ? undefined : context.entityOf(node.member);
  if (qualified?.kind === 'variant') {
    return checkVariantName(context, node, qualified, expected);
  }
  const functions = namedFunctions(context, node);
  if (functions !== undefined) {
    return checkFunctionValue(context, functions, expected);
  }
  if (qualified !== undefined) {
    return entityValueType(context, node.member, qualified, expected);
  }
  const owner = node.isOptional ? undefined : namedType(context, node.target);
  if (owner !== undefined) {
    context.report(
      checkerDiagnostics.noStaticFunction(node.member.span, typeText(owner), node.member.text),
    );
    return errorType;
  }
  const type = context.chains.target(context, node);
  if (type.kind === 'error') {
    return errorType;
  }
  const name = node.member.text;
  const field = fieldOf(context, type, name);
  if (field !== undefined) {
    return field;
  }
  if (name === 'value' && type.kind === 'nominal' && context.checker.stateOf(type) !== undefined) {
    return checkHandleValue(context, node, type);
  }
  const isMethod = topLevelCandidates(context.checker, context.module, name, [type]).some(
    ({ declaration }) => isMethodDeclaration(declaration),
  );
  context.report(
    isMethod
      ? checkerDiagnostics.methodValue(node.member.span, name)
      : checkerDiagnostics.unknownField(node.member.span, typeText(type), name),
  );
  return errorType;
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

/** Which types a member passed to a call can take when the call decides it: a function's (names.ts). */
export function memberAccepts(context: BodyContext, node: MemberAccess): Accepts | undefined {
  const functions = namedFunctions(context, node);
  return functions === undefined ? undefined : functionsAccepted(context, functions);
}

/** Which types a literal of a bare variant (`Rejected{by: "legal"}`) can take: its enums. */
export function structLiteralAccepts(
  context: BodyContext,
  node: StructLiteral,
): Accepts | undefined {
  return node.type === undefined
    ? undefined
    : variantsAccepted(context, context.entityOf(lastName(node.type.path)));
}
