/**
 * Building structs (§3.1); reading their fields is member-access.ts's.
 *
 * - A struct literal names its type, or with `struct{…}` takes it: from the expected type when
 *   that is a struct, else from a leading spread's value, else it is the shape of its named items,
 *   each typed by its value. A literal through an alias of a shape builds the shape (§3.17).
 * - Its items are checked by the path variants share (literal-fields.ts), so a generic struct's
 *   type arguments are written, expected, spread or inferred alike. A literal naming a variant
 *   builds that variant (variants.ts).
 * - A struct without fields is written bare (names.ts), so braces after one are an error, whatever
 *   they hold.
 * - A shared struct is built with `new` and only one is (§3.18): its literal checks as any other,
 *   braces and all, and its type is the shared struct, while a spread gives it the value behind
 *   another (`new Inbox{...*box}`).
 */

import { isDeclaredStruct } from '../../syntax/declarations.ts';
import {
  type FieldsLiteral,
  itemValue,
  type StructLiteral,
} from '../../syntax/expressions/index.ts';
import { fieldsFunctionOf } from '../../syntax/field-defaults.ts';
import { lastName } from '../../syntax/node.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { AcceptedPart, Accepts, BodyContext } from '../body-context.ts';
import type { FieldSource } from '../check.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { partsAccept, partsBuild } from '../rules/agreement.ts';
import { builtFrom } from '../types/expected.ts';
import { inFieldOrder } from '../types/field-order.ts';
import {
  errorType,
  type FieldMember,
  type NominalEntity,
  type NominalType,
  shapeType,
  type Type,
} from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { checkLiteralFields, type LiteralShape, type LiteralSpread } from './literal-fields.ts';
import { builtThrough } from './literal-types.ts';
import { checkVariantLiteral, variantsAccepted } from './variants.ts';

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
    checkNew(context, node, false);
    return checkVariantLiteral(context, node, entity, expected);
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
    return checkLiteralFields(context, node, built.shape, leadingSpread(node));
  }
  const shape = declaredShape(context, built.entity, built.known);
  if (shape.fields.length === 0 && built.struct.kind === 'StructDeclaration') {
    context.report(checkerDiagnostics.bareStruct(node.span, name.text));
    checkValuesAlone(context, node);
    return shape.typeOf([]);
  }
  return checkLiteralFields(context, node, shape, leadingSpread(node));
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
      const type = context.expression(value);
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
    } else if (item.kind !== 'Invalid') {
      context.report(checkerDiagnostics.unnamedAnonymousField(item.span));
      context.expression(item.kind === 'Spread' ? item.expression : item.value);
      fits = false;
    }
  }
  const ordered = inFieldOrder(given);
  if (fits) {
    context.literals.record(
      node,
      ordered.map((each) => each.source),
    );
  }
  return shapeType(
    node,
    ordered.map((each) => each.field),
  );
}

/** Checks every value of a literal whose type is unknown, so each is still recorded. */
function checkValuesAlone(context: BodyContext, node: FieldsLiteral): void {
  for (const item of node.items) {
    if (item.kind === 'Spread') {
      context.expression(item.expression);
    } else if (item.kind !== 'Invalid') {
      context.expression(itemValue(item));
    }
  }
}

/**
 * Which types a literal the call it is passed to decides can take (§3.5): a bare variant's
 * (`Rejected{by: "legal"}`) its enums; a `struct{…}`, once a value it gives needs the type expected
 * of it, a struct type with a field of each name it gives, each value taking that field's type.
 */
export function structLiteralAccepts(
  context: BodyContext,
  node: StructLiteral,
): Accepts | undefined {
  if (node.type !== undefined) {
    return variantsAccepted(context, context.entityOf(lastName(node.type.path)));
  }
  return fieldsTaking(context, node, partsAccept);
}

/**
 * Which struct types a `struct{…}` literal of values each with a type of its own can be built as
 * instead of its shape (§3.7): those with a field of each name it gives, each value fitting it.
 */
export function structLiteralBuilds(
  context: BodyContext,
  node: StructLiteral,
): Accepts | undefined {
  return node.type === undefined ? fieldsTaking(context, node, partsBuild) : undefined;
}

/**
 * The shape a `struct{…}` literal has on its own, when each value it gives has a type of its own
 * known before checking: the type checking it with nothing expected gives.
 */
export function structLiteralKnownType(
  context: BodyContext,
  node: StructLiteral,
): Type | undefined {
  if (node.type !== undefined) {
    return undefined;
  }
  const fields: FieldMember[] = [];
  for (const item of node.items) {
    if (item.kind !== 'FieldInitializer' || fields.some(({ name }) => name === item.name.text)) {
      return undefined;
    }
    const part = context.acceptedPart(itemValue(item));
    if (part.kind !== 'typed' || part.type === undefined) {
      return undefined;
    }
    fields.push({ name: item.name.text, type: part.type });
  }
  return shapeType(node, fields);
}

/** The struct types whose field of each name `node` gives the value read by `read` takes. */
function fieldsTaking(
  context: BodyContext,
  node: StructLiteral,
  read: (context: BodyContext, parts: readonly AcceptedPart[]) => readonly Accepts[] | undefined,
): Accepts | undefined {
  const named = node.items.flatMap((item) => (item.kind === 'FieldInitializer' ? [item] : []));
  const values =
    named.length === node.items.length
      ? read(
          context,
          named.map((item) => context.acceptedPart(itemValue(item))),
        )
      : undefined;
  if (values === undefined) {
    return undefined;
  }
  return (expected, isOpen) => {
    const target = builtFrom(expected);
    const fields = target === undefined ? undefined : context.checker.fieldsOf(target);
    return (
      fields !== undefined &&
      named.every((item, index) => {
        const field = fields.find(({ name }) => name === item.name.text);
        return field !== undefined && (values[index]?.(field.type, isOpen) ?? true);
      })
    );
  };
}
