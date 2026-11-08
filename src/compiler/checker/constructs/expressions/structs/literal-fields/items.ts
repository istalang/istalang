/**
 * A struct literal's items (§3.1): which field each gives, checked against its type where it is
 * known or else on its own and matched for inference, and what the items leave out: a field
 * missing, or one its default gives. The literal is completed with them in index.ts.
 */

import {
  type DeclaredStruct,
  type FunctionDeclaration,
  hasDefault,
  type TypeAliasDeclaration,
} from '../../../../../syntax/declarations/index.ts';
import type {
  Expression,
  FieldItem,
  FieldsLiteral,
  Spread,
} from '../../../../../syntax/expressions/index.ts';
import {
  itemName,
  itemValue,
  unparenthesized,
} from '../../../../../syntax/expressions/readings.ts';
import { lastName } from '../../../../../syntax/tree/node.ts';
import type { BodyContext } from '../../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../../diagnostics/index.ts';
import { callWithTypes } from '../../../../resolution/applying/silent-choice.ts';
import type { FunctionCall } from '../../../../surface/resolved-call.ts';
import { itemField } from '../../../../surface/struct-items.ts';
import type { Inference } from '../../../../types/inference/infer.ts';
import { parametersIn } from '../../../../types/parts/type-parts.ts';
import type { FieldMember, Type } from '../../../../types/type/index.ts';
import { typeText } from '../../../../types/type/type-text.ts';
import { writtenLiteral } from '../../../../types/unions/unions.ts';

/**
 * What a literal builds: its fields as declared, how to name its type from type arguments, and
 * the generic declaration they belong to: a struct, an alias of a shape for a shape it names
 * (§3.17), absent for any other shape.
 */
export interface LiteralShape {
  readonly owner: DeclaredStruct | TypeAliasDeclaration | undefined;
  /** The function the declaration's fields read as when one has a default (§3.1). */
  readonly defaults?: FunctionDeclaration | undefined;
  /** The type arguments already decided, written or expected. */
  readonly known: readonly Type[] | undefined;
  /**
   * The type expected of the literal, when it is a union with members of the literal's own type
   * none of which the literal takes: a literal that can't infer its type arguments then doesn't fit
   * it, which is what is reported.
   */
  readonly expected?: Type | undefined;
  readonly fields: readonly FieldMember[];
  readonly typeOf: (typeArguments: readonly Type[]) => Type;
  /** The type a spread gives when not the literal's own: a shared struct's value (§3.18). */
  readonly spreadOf?: (typeArguments: readonly Type[]) => Type;
}

/** A struct literal's leading spread, and its type when the caller checked it already. */
export interface LiteralSpread {
  readonly node: Spread;
  readonly type?: Type;
}

/** A field given a value: the value, its type, and the field's type as declared. */
export interface GivenField {
  readonly node: Expression;
  readonly type: Type;
  readonly declared: Type;
}

/** What checking a literal's items keeps track of. */
export interface LiteralItems {
  readonly node: FieldsLiteral;
  readonly shape: LiteralShape;
  readonly inference: Inference;
  /** The fields given so far, by position in the shape. */
  readonly given: Map<number, GivenField>;
  /** Whether every item so far gave a field of its own. */
  fits: boolean;
}

/**
 * Checks one item of a literal: its value against its field's type when that is already known,
 * else on its own, matched for inference, a literal with its literal type where the field expects
 * one, as a member parameter's does (§2, §3.5).
 */
export function checkItem(
  context: BodyContext,
  items: LiteralItems,
  item: FieldsLiteral['items'][number],
  spread: Spread | undefined,
): void {
  if (item.kind === 'Invalid' || item.kind === 'StructComprehension' || item === spread) {
    return;
  }
  if (item.kind === 'Spread') {
    context.report(checkerDiagnostics.misplacedSpread(item.span));
    context.expression(item.expression);
    items.fits = false;
    return;
  }
  const { shape, inference, given } = items;
  const name = itemName(item);
  const index = itemField(name, shape.fields);
  const field = shape.fields[index];
  if (field !== undefined && name !== undefined) {
    context.recordField(name, field);
  }
  const value = itemValue(item);
  if (field === undefined || given.has(index)) {
    reportMisfit(context, items, item, field);
    context.expression(value);
    items.fits = false;
    return;
  }
  const declared = inference.substituted(field.type);
  const isKnown = parametersIn(declared).every((parameter) => !inference.isUnknown(parameter));
  const literal = writtenLiteral(unparenthesized(value));
  const literalType =
    literal === undefined ? undefined : inference.literalType(literal.value, field.type);
  const type = context.expression(value, isKnown ? declared : literalType);
  if (!isKnown) {
    inference.match(field.type, type);
  }
  given.set(index, { node: value, type, declared: field.type });
}

/** An item giving no field of its own: no field by that name or position, or one given twice. */
function reportMisfit(
  context: BodyContext,
  { node, shape }: LiteralItems,
  item: FieldItem,
  field: FieldMember | undefined,
): void {
  if (item.kind === 'PositionalInitializer') {
    const count = shape.fields.length;
    context.report(checkerDiagnostics.positionalNeedsOneField(item.span, literalName(node), count));
  } else if (field === undefined) {
    context.report(
      checkerDiagnostics.unknownField(item.name.span, literalName(node), item.name.text),
    );
  } else {
    context.report(checkerDiagnostics.repeatedField(item.name.span, field.name));
  }
}

/**
 * With names alone, a field no item names is missing, unless it has a default: one that can't be
 * called for these type arguments is reported where they are checked, not as a missing field. A
 * struct comprehension gives the fields at `comprehended` and leaves none to a default (§3.1).
 */
export function reportMissing(
  context: BodyContext,
  { node, shape, given }: LiteralItems,
  type: Type,
  comprehended: ReadonlySet<number> | undefined,
): void {
  const named = node.items.every(
    (item) =>
      item.kind === 'FieldInitializer' ||
      item.kind === 'StructComprehension' ||
      item.kind === 'Invalid',
  );
  if (!named) {
    return;
  }
  const at = node.type?.span ?? node.span;
  const isGiven = (index: number) =>
    given.has(index) ||
    (comprehended === undefined ? declaresDefault(shape.fields[index]) : comprehended.has(index));
  for (const [index, field] of shape.fields.entries()) {
    if (!isGiven(index)) {
      context.report(checkerDiagnostics.missingField(at, typeText(type), field.name));
    }
  }
}

/** Whether `field` declares a default (§3.1), as only a declared struct's or variant's can. */
export function declaresDefault(field: FieldMember | undefined): boolean {
  const declared = field?.declared?.node;
  return declared !== undefined && hasDefault(declared);
}

/**
 * By field position, for each field the literal leaves out, the call of `shape`'s defaults with the
 * literal's `typeArguments`, whose default for that field gives it. Its parameters are the fields
 * in order, so they are numbered as the shape's fields are (syntax/declarations/field-defaults.ts).
 */
export function defaultCalls(
  context: BodyContext,
  shape: LiteralShape,
  given: ReadonlyMap<number, GivenField>,
  typeArguments: readonly Type[],
): readonly (FunctionCall | undefined)[] {
  const { defaults, fields } = shape;
  const isLeftOut = (index: number) => !given.has(index) && declaresDefault(shape.fields[index]);
  if (defaults === undefined || !fields.some((_, index) => isLeftOut(index))) {
    return [];
  }
  const candidates = [{ declaration: defaults }];
  const call = callWithTypes(context.checker, candidates, typeArguments);
  return fields.map((_, index) => (isLeftOut(index) ? call : undefined));
}

export function literalName(node: FieldsLiteral): string {
  return node.type === undefined ? 'struct' : lastName(node.type.path).text;
}
