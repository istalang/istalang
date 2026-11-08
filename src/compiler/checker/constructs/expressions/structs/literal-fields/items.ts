/**
 * A struct literal's items (§3.1): which field each gives, checked against its type where it is
 * known or else on its own and matched for inference, and what the items leave out: a field
 * missing, or one its default gives. The literal is completed with them in index.ts.
 */

import type {
  DeclaredStruct,
  FunctionDeclaration,
  TypeAliasDeclaration,
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
import { declaresDefault } from '../../../../types/type/field-defaults.ts';
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
  /** The type arguments already decided: written, or a struct's own where one is expected. */
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
  /** Whether it is a written literal, which has its literal type where its field expects one. */
  readonly isLiteral: boolean;
}

/** What checking a literal's items keeps track of. */
export interface LiteralItems {
  readonly node: FieldsLiteral;
  readonly shape: LiteralShape;
  readonly inference: Inference;
  /** The fields given so far, by position in the shape. */
  readonly given: Map<number, GivenField>;
  /**
   * Whether its values were checked already, as a `struct{…}`'s are before what it builds is
   * decided (../structs.ts): each is then read as checked, never checked again.
   */
  readonly checked: boolean;
  /** Whether every item so far gave a field of its own. */
  fits: boolean;
}

/**
 * Checks one item of a literal: its value against its field's type when that is already known,
 * else in the literal's constraint scope, which postpones one that needs what is expected of it to
 * its placeholder, matched for inference, a literal with its literal type where the field expects
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
    checkRefused(context, item.expression);
    items.fits = false;
    return;
  }
  const { shape, given } = items;
  const name = itemName(item);
  const index = itemField(name, shape.fields);
  const field = shape.fields[index];
  if (field !== undefined && name !== undefined) {
    context.recordField(name, field);
  }
  const value = itemValue(item);
  if (field === undefined || given.has(index)) {
    reportMisfit(context, items, item, field);
    checkRefused(context, value);
    items.fits = false;
    return;
  }
  checkFieldValue(context, items, { index, value, field });
}

/**
 * Matches `type`, a value's, where `declared` is taken; one still open in the scope that doesn't
 * match gets the error type where it goes (`Scopes.abandon`), so the misfit, reported once the
 * literal is fitted (`fitItems`), is all that is reported of it.
 */
function matchValue(context: BodyContext, inference: Inference, declared: Type, type: Type): void {
  if (!inference.match(declared, type) && context.scopes.holds(type)) {
    context.scopes.abandon([type]);
  }
}

/**
 * Checks a value no field of the literal takes, giving the error type where it would go
 * (`Scopes.abandon`), so what only the literal would have bounded reports nothing more.
 */
export function checkRefused(context: BodyContext, value: Expression): void {
  context.scopes.abandon([context.expression(value)]);
}

/** The value an item gives the field at `index` of the literal's shape. */
interface FieldValue {
  readonly index: number;
  readonly value: Expression;
  readonly field: FieldMember;
}

/**
 * Checks a field's value: against the field's type when that is known, naming no variable of the
 * constraint scope; else in the literal's scope, expected to be what that type is so far, and
 * matched, a literal with its literal type where the field expects one (§2, §3.5).
 */
function checkFieldValue(
  context: BodyContext,
  items: LiteralItems,
  { index, value, field }: FieldValue,
): void {
  const { inference, given } = items;
  const declared = inference.settledIn(field.type);
  const isKnown =
    !context.scopes.holds(declared) &&
    parametersIn(declared).every((parameter) => !inference.isUnknown(parameter));
  if (isKnown) {
    const type = checkedValue(context, items, value, declared);
    if (context.scopes.holds(type)) {
      matchValue(context, inference, field.type, type);
    }
    given.set(index, { node: value, type, declared: field.type, isLiteral: false });
    return;
  }
  const literal = writtenLiteral(unparenthesized(value));
  const expected =
    literal === undefined
      ? inference.open(field.type)
      : inference.literalType(literal.value, field.type);
  const type = checkedValue(context, items, value, expected);
  if (literal === undefined) {
    matchValue(context, inference, field.type, type);
  } else {
    inference.matchLiteral(field.type, literal);
  }
  given.set(index, { node: value, type, declared: field.type, isLiteral: literal !== undefined });
}

/** `value`'s type: as checked already where `items`' values were, else checked expecting `expected`. */
function checkedValue(
  context: BodyContext,
  items: LiteralItems,
  value: Expression,
  expected: Type | undefined,
): Type {
  const checked = items.checked ? context.checkedTypeOf(value) : undefined;
  return checked ?? context.expression(value, expected);
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
