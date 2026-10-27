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
 * - A shared struct is built with `new` and only one is (§3.18): its literal checks as any other,
 *   braces and all, and its type is the shared struct, while a spread gives it the value behind
 *   another (`new Inbox{...*box}`).
 * - Reading `s.f` gives the field's type, substituted for the struct's type arguments; through a
 *   type parameter, a field a constraint requires (§3.10). A member that isn't a field is
 *   reported as unknown here, or, when it is a field of the value behind a handle, as to be read
 *   with `->` (§3.9); a call of one is a method call (calls.ts).
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Entity } from '../../binder/entities.ts';
import { isMethod as isMethodDeclaration, isSharedStruct } from '../../syntax/declarations.ts';
import {
  itemValue,
  type MemberAccess,
  type StructLiteral,
} from '../../syntax/expressions/index.ts';
import { fieldsFunctionOf } from '../../syntax/field-defaults.ts';
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
import { knownConstraints, requiredFields, requiredFieldType } from '../traits/constraints.ts';
import { optionalInner } from '../types/fit.ts';
import { insideOptional } from '../types/inside-optional.ts';
import {
  errorType,
  type FieldMember,
  isNominalEntity,
  type NominalEntity,
  type NominalType,
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
  checkNew(context, node, entity);
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
  if (shape.fields.length === 0 && !entity.declaration.isShared) {
    context.report(checkerDiagnostics.bareStruct(node.span, name.text));
    checkValuesAlone(context, node);
    return shape.typeOf([]);
  }
  return checkLiteralFields(context, node, shape, spread);
}

/**
 * Reports a literal of a shared struct without `new`, or `new` before another (§3.18); the
 * literal is checked as written all the same.
 */
function checkNew(context: BodyContext, node: StructLiteral, entity: Entity | undefined): void {
  if (entity === undefined || node.type === undefined) {
    return;
  }
  const isShared = entity.kind === 'type' && isSharedStruct(entity.declaration);
  const name = lastName(node.type.path).text;
  if (isShared && !node.isNew) {
    context.report(checkerDiagnostics.sharedNeedsNew(node.type.span, name));
  } else if (!isShared && node.isNew) {
    context.report(checkerDiagnostics.newNotShared(node.type.span, name));
  }
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

/**
 * How a literal builds a value of `type`, a struct type, with its type arguments; else undefined.
 * A shared struct is built only with `new` and its name.
 */
function shapeOf(context: BodyContext, type: Type): LiteralShape | undefined {
  if (type.kind === 'anonymous') {
    return { owner: undefined, known: undefined, fields: type.fields, typeOf: () => type };
  }
  if (type.kind === 'nominal' && context.checker.fieldsOf(type) !== undefined) {
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
  const typeOf = (typeArguments: readonly Type[]): NominalType => ({
    kind: 'nominal',
    entity,
    arguments: typeArguments,
  });
  return {
    owner: struct,
    defaults: struct === undefined ? undefined : fieldsFunctionOf(struct),
    known,
    fields: struct === undefined ? [] : context.checker.declaredFieldsOf(struct),
    typeOf,
    spreadOf: (typeArguments) => {
      const type = typeOf(typeArguments);
      return context.checker.sharedValueOf(type) ?? type;
    },
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
  const field = fieldOf(context, type, node.member.text);
  if (field === undefined) {
    context.report(noField(context, node, type));
    return errorType;
  }
  return field;
}

/**
 * Why `node` reads no field of `type`: it is behind the shared struct `type` is (`->`), or inside
 * the optional it is (`?.`, or `?->` for an optional shared struct), or `node` names a method,
 * read only by calling.
 */
function noField(context: BodyContext, node: MemberAccess, type: Type): Diagnostic {
  const { checker } = context;
  const { span, text: name } = node.member;
  const behind = (owner: Type) => {
    const sharedValue = checker.sharedValueOf(owner);
    return sharedValue !== undefined && fieldOf(context, sharedValue, name) !== undefined;
  };
  if (behind(type)) {
    const operator = node.isOptional ? '?->' : '->';
    return checkerDiagnostics.fieldBehindShared(span, typeText(type), name, operator);
  }
  const inner = optionalInner(type, checker.optionalEntity);
  const reach = inner !== undefined && checker.sharedValueOf(inner) !== undefined ? '?->' : '?.';
  const inside = insideOptional(checker, span, type, reach);
  if (inside !== undefined) {
    return inside;
  }
  const isMethod = topLevelCandidates(checker, context.module, name, [type]).some(
    ({ declaration }) => isMethodDeclaration(declaration),
  );
  return isMethod
    ? checkerDiagnostics.methodValue(span, name)
    : checkerDiagnostics.unknownField(span, typeText(type), name);
}

/** The type of the field `name` of `type`, through a constraint for a type parameter. */
function fieldOf(context: BodyContext, type: Type, name: string): Type | undefined {
  const { checker } = context;
  if (type.kind === 'nominal' || type.kind === 'anonymous') {
    return checker.fieldsOf(type)?.find((candidate) => candidate.name === name)?.type;
  }
  for (const constraint of knownConstraints(checker, type)) {
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
