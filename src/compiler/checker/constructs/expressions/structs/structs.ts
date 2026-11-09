/**
 * Building structs (§3.1); reading their fields is ../access/member-access.ts's.
 *
 * - A struct literal names its type, or with `struct{…}` takes it: from the expected type when
 *   that is a struct, else from a leading spread's value, else it is the shape of its named items,
 *   each typed by its value. A literal through an alias of a shape builds the shape (§3.17).
 * - Its items are checked by one path (literal-fields/index.ts), so a generic struct's type
 *   arguments are written, expected, spread or inferred alike. A variant is built by its call
 *   (variants.ts), so braces after a variant's name, or a block below it, are refused, naming the
 *   call.
 * - A struct without fields is written bare (../access/names.ts), so braces after one are an error,
 *   whatever they hold.
 * - A shared struct is built with `new` and only one is (§3.18): its literal checks as any other,
 *   braces and all, and its type is the shared struct, while a spread gives it the value behind
 *   another (`new Inbox{...*box}`).
 */

import { fieldsFunctionOf } from '../../../../syntax/declarations/field-defaults.ts';
import { isDeclaredStruct } from '../../../../syntax/declarations/index.ts';
import type { FieldsLiteral, StructLiteral } from '../../../../syntax/expressions/index.ts';
import { itemValue } from '../../../../syntax/expressions/readings.ts';
import { lastName } from '../../../../syntax/tree/node.ts';
import type { NamedType } from '../../../../syntax/types/index.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { placeholderOf } from '../../../rules/placeholders.ts';
import type { FieldSource } from '../../../surface/checked-body.ts';
import { builtFrom } from '../../../types/fitting/expected.ts';
import { takesShape } from '../../../types/inference/system-reading.ts';
import { inFieldOrder } from '../../../types/type/field-order.ts';
import {
  type FieldMember,
  type NominalEntity,
  type NominalType,
  shapeType,
  type Type,
  type UnionType,
} from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { checkLiteralFields } from './literal-fields/index.ts';
import { checkRefused, type LiteralShape, type LiteralSpread } from './literal-fields/items.ts';
import { builtThrough } from './literal-types.ts';
import {
  checkComprehensionAlone,
  checkOpaqueComprehended,
  comprehensionOf,
  freshComprehended,
} from './struct-comprehensions.ts';
import { refuseVariantLiteral } from './variants.ts';

/** Checks a struct literal: one naming its type in the current constraint scope, as its values. */
export function checkStructLiteral(
  context: BodyContext,
  node: StructLiteral,
  expected: Type | undefined,
): Type {
  return namesItsType(node)
    ? checkNamedLiteral(context, node, expected)
    : checkAnonymousLiteral(context, node, expected, leadingSpread(node));
}

/** A literal that names its type: `Pair{…}`, a variant's, or `new Inbox<T>{…}`. */
type NamedLiteral = FieldsLiteral & { readonly type: NamedType };

function namesItsType(node: FieldsLiteral): node is NamedLiteral {
  return node.type !== undefined;
}

function leadingSpread(node: FieldsLiteral): LiteralSpread | undefined {
  const [first] = node.items;
  return first?.kind === 'Spread' ? { node: first } : undefined;
}

/**
 * A literal naming a variant or a declared struct, with `new` or not, or an alias of a struct type,
 * which builds the type it stands for (§3.17).
 */
export function checkNamedLiteral(
  context: BodyContext,
  node: NamedLiteral,
  expected: Type | undefined,
): Type {
  const typeNode = node.type;
  const name = lastName(typeNode.path);
  const entity = context.entityOf(name);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    checkValuesAlone(context, node);
    return refuseVariantLiteral(context, node.span, name, { naming: entity, expected });
  }
  if (entity === undefined) {
    return errorType;
  }
  const built = builtThrough(context, node, entity, expected);
  checkNew(
    context,
    node,
    built?.kind === 'declared' && built.struct.kind === 'SharedStructDeclaration',
  );
  if (built === undefined) {
    context.report(checkerDiagnostics.notStruct(typeNode.span, name.text));
    return errorType;
  }
  if (built.kind === 'shape') {
    return checkLiteralFields(context, node, built.shape, {
      spread: leadingSpread(node),
      expected: built.expected,
    });
  }
  const shape = {
    ...declaredShape(context, built.entity, built.known),
    expected: unionHolding(expected, built.entity),
  };
  if (shape.fields.length === 0 && built.struct.kind === 'StructDeclaration') {
    context.report(checkerDiagnostics.bareStruct(node.span, name.text));
    checkValuesAlone(context, node);
    return shape.typeOf([]);
  }
  return checkLiteralFields(context, node, shape, {
    spread: leadingSpread(node),
    expected: built.expected,
  });
}

/**
 * Reports a literal of a shared struct without `new`, or `new` before another type (§3.18); the
 * literal is checked as written all the same.
 */
function checkNew(context: BodyContext, node: NamedLiteral, isShared: boolean): void {
  const name = lastName(node.type.path).text;
  if (isShared && node.kind === 'StructLiteral') {
    context.report(checkerDiagnostics.sharedNeedsNew(node.type.span, name));
  } else if (!isShared && node.kind === 'NewStructLiteral') {
    context.report(checkerDiagnostics.newNotShared(node.type.span, name));
  }
}

/** `struct{…}`: the expected struct, a leading spread's struct, or else the shape of its items. */
function checkAnonymousLiteral(
  context: BodyContext,
  node: StructLiteral,
  expected: Type | undefined,
  spread: LiteralSpread | undefined,
): Type {
  const target = builtFrom(expected);
  const fromExpected = target === undefined ? undefined : shapeOf(context, target);
  if (fromExpected !== undefined) {
    return checkLiteralFields(context, node, fromExpected, { spread });
  }
  const comprehension = comprehensionOf(node);
  if (comprehension !== undefined && target !== undefined && hasKeys(context, target)) {
    return checkOpaqueComprehended(context, node, comprehension, target);
  }
  if (spread === undefined) {
    // A `struct{…}` opens a scope where none is open (wiring/body/scope-protocol.ts).
    return builtOnceExpected(context, node, freshAnonymous(context, node), expected);
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
  return checkLiteralFields(context, node, fromSpread, { spread: { ...spread, type } });
}

/**
 * Whether `type` is a struct type whose fields aren't all known yet, which has keys all the same
 * (§3.1).
 */
function hasKeys(context: BodyContext, type: Type): boolean {
  return context.checker.typeRules.keysOf(type, []).kind !== 'error';
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

/**
 * `expected`, when it is a union with a member of `entity`'s type: none of them took the literal,
 * or it would be expected alone (types/fitting/expected.ts), so a literal inferring no type
 * arguments of its own doesn't fit it.
 */
function unionHolding(expected: Type | undefined, entity: NominalEntity): Type | undefined {
  return expected?.kind === 'union' &&
    expected.members.some((member) => member.kind === 'nominal' && member.entity === entity)
    ? expected
    : undefined;
}

/** How a literal builds the declared struct `entity` names, from its declared fields. */
function declaredShape(
  context: BodyContext,
  entity: NominalEntity,
  known: readonly Type[] | undefined,
): LiteralShape {
  const { declaration } = entity;
  const struct = isDeclaredStruct(declaration) ? declaration : undefined;
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
 * A `struct{…}` of `shape` in a constraint scope that doesn't know yet what it builds
 * (docs/work/variance-inference/i2-scope.md §3): a placeholder of the scope, bounded below by its
 * shape, marked as one, and above by what it is `expected` to be, so a call choosing sees its
 * fields' types and it settles on a struct its fields give where one is expected (§3.1). The scope builds it once it knows what is expected of
 * it, of its fields as they were checked, so a field the scope postponed is told what it is
 * expected to be then; with nothing expected, it is its shape.
 */
function builtOnceExpected(
  context: BodyContext,
  node: StructLiteral,
  shape: Type,
  expected: Type | undefined,
): Type {
  const { inference, type } = placeholderOf(context, node);
  const judge = (known: Type | undefined) => builtAs(context, node, shape, known);
  context.scopes.postpone({ node, inference, type, admits: () => true, judge, standsAlone: true });
  inference.matchShape(type, shape);
  if (expected !== undefined) {
    inference.match(expected, type);
  }
  return type;
}

/**
 * What a `struct{…}` of `shape`, its fields checked already, builds where `expected` is expected
 * (§3.1): the struct or shape `expected` is, or of a union the one member it gives the fields of,
 * built of its fields as they were checked; else its own shape.
 */
function builtAs(
  context: BodyContext,
  node: StructLiteral,
  shape: Type,
  expected: Type | undefined,
): Type {
  const target = builtFrom(expected);
  const member = target?.kind === 'union' ? memberTaking(context, target, shape) : target;
  const built = member === undefined ? undefined : shapeOf(context, member);
  return built === undefined ? shape : checkLiteralFields(context, node, built, { checked: true });
}

/** The one member of `union` a `struct{…}` of `shape` builds or fits, if one is. */
function memberTaking(context: BodyContext, union: UnionType, shape: Type): Type | undefined {
  const { fitting } = context.checker;
  const taking = union.members.filter(
    (member) =>
      takesShape(member, shape, fitting) || context.checker.fitOf(shape, member) !== undefined,
  );
  return taking.length === 1 ? taking[0] : undefined;
}

/**
 * A `struct{…}` with nothing to take a type from: the shape of its named items, typed by their
 * values (§3.1). Its fields keep the shape's name order, and so do the sources recorded for them.
 */
function freshAnonymous(context: BodyContext, node: StructLiteral): Type {
  const given: {
    readonly name: string;
    readonly field: FieldMember;
    readonly source: FieldSource;
  }[] = [];
  let fits = true;
  for (const item of node.items) {
    if (item.kind === 'FieldInitializer') {
      const value = itemValue(item);
      const type = context.part(value);
      if (given.some((each) => each.name === item.name.text)) {
        context.report(checkerDiagnostics.repeatedField(item.name.span, item.name.text));
        fits = false;
      } else {
        given.push({
          name: item.name.text,
          field: { name: item.name.text, type },
          source: { field: item.name.text, kind: 'value', value },
        });
      }
    } else if (item.kind !== 'Invalid' && item.kind !== 'StructComprehension') {
      context.report(checkerDiagnostics.unnamedAnonymousField(item.span));
      context.expression(item.kind === 'Spread' ? item.expression : item.value);
      fits = false;
    }
  }
  const comprehended = freshComprehended(context, node, new Set(given.map(({ name }) => name)));
  const ordered = inFieldOrder(given);
  if (fits && comprehended !== undefined) {
    context.literals.record(node, [...ordered.map((each) => each.source), ...comprehended.sources]);
  }
  return shapeType(node, [...ordered.map((each) => each.field), ...(comprehended?.fields ?? [])]);
}

/** Checks every value of a literal whose type is unknown, so each is still recorded. */
function checkValuesAlone(context: BodyContext, node: FieldsLiteral): void {
  for (const item of node.items) {
    if (item.kind === 'Spread') {
      checkRefused(context, item.expression);
    } else if (item.kind === 'StructComprehension') {
      checkComprehensionAlone(context, item);
    } else if (item.kind !== 'Invalid') {
      checkRefused(context, itemValue(item));
    }
  }
}
