/**
 * The fields of a struct or variant literal (§3.1, §3.11), the one path both are built through,
 * and where each field's value comes from, which the checker records for later phases.
 *
 * - Every field is given exactly once, each value fitting the field's type, by the one rule of
 *   which field an item gives (struct-items.ts): by name, by the shorthand `first` for
 *   `first: first`, or positionally when there is one field. With names alone, every field must
 *   be given, but for those with a default; a struct literal's leading spread gives the rest, and a
 *   positional value is the only item (the parser enforces that), so neither leaves fields to
 *   report as missing. A variant can't be spread into: which variant a value holds isn't known
 *   when compiling.
 * - A generic type's arguments are written, taken from the expected type or the spread value when
 *   it is the same type, or inferred from the values (§3.5): a value whose field type is already
 *   known is checked against it, any other is checked on its own and matched. Defaults fill what
 *   is left; anything still open can't be inferred. A shape has no type parameters, but an alias
 *   naming one may (§3.17), and a literal through it infers them as a struct's.
 * - What each field's value comes from is recorded per literal, in declaration order
 *   (literal-sources.ts), so lowering and compile time read it rather than reading the items
 *   again. A literal with a mistake in its items has no record: nothing compiles it.
 * - A field left out with names alone takes its default (§3.1), from that field's default of the
 *   function the declaration's fields read as (syntax/field-defaults.ts), instantiated with the
 *   literal's type arguments, its constraints met where the literal is. A spread gives every
 *   field, so a literal with one runs no default.
 */

import {
  type DeclaredStruct,
  type EnumDeclaration,
  type FunctionDeclaration,
  hasDefault,
  type TypeAliasDeclaration,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import {
  type Expression,
  type FieldItem,
  type FieldsLiteral,
  itemName,
  itemValue,
  type Spread,
  unparenthesized,
} from '../../syntax/expressions/index.ts';
import { lastName } from '../../syntax/node.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { completeInference } from '../inference/complete.ts';
import { Inference } from '../inference/infer.ts';
import { callWithTypes } from '../resolution/silent-choice.ts';
import type { FunctionCall } from '../resolved-call.ts';
import { itemField } from '../struct-items.ts';
import { constrainArguments, parameterType, typeArgumentsFor } from '../types/resolve-type.ts';
import { type Substitution, substitute } from '../types/substitution.ts';
import { errorType, type FieldMember, type ParameterKey, type Type } from '../types/type.ts';
import { parametersIn } from '../types/type-parts.ts';
import { typeText } from '../types/type-text.ts';
import { writtenLiteral } from '../types/unions.ts';
import { type LiteralGiven, sourcesOf } from './literal-sources.ts';

/**
 * What a literal builds: its fields as declared, how to name its type from type arguments, and
 * the generic declaration they belong to: a struct's or a variant's enum, an alias of a shape for
 * a shape it names (§3.17), absent for any other shape.
 */
export interface LiteralShape {
  readonly owner: DeclaredStruct | EnumDeclaration | TypeAliasDeclaration | undefined;
  /** The function the declaration's fields read as when one has a default (§3.1). */
  readonly defaults?: FunctionDeclaration | undefined;
  /** The type arguments already decided, written or expected. */
  readonly known: readonly Type[] | undefined;
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
interface GivenField {
  readonly node: Expression;
  readonly type: Type;
  readonly declared: Type;
}

/**
 * Checks `node`'s items against `shape`; the literal's type. `spread` is a struct literal's
 * leading spread.
 */
export function checkLiteralFields(
  context: BodyContext,
  node: FieldsLiteral,
  shape: LiteralShape,
  spread?: LiteralSpread,
): Type {
  const spreadType =
    spread === undefined ? undefined : (spread.type ?? context.expression(spread.node.expression));
  const parameters = shape.owner === undefined ? [] : typeParametersOf(shape.owner.typeParameters);
  const decided = decidedArguments(shape, parameters);
  const inference = new Inference(parameters, context.checker.fitting, decided);
  if (spreadType !== undefined) {
    inference.match(spreadOf(shape, parameters.map(parameterType)), spreadType);
  }
  const items: LiteralItems = { node, shape, inference, given: new Map(), fits: true };
  for (const item of node.items) {
    checkItem(context, items, item, spread?.node);
  }
  const completed = complete(context, node, shape, inference);
  const found = completed?.substitution ?? inference.substitution();
  context.literals.recordFields(
    node,
    shape.fields.map((field) => ({
      ...field,
      type: substitute(field.type, found, context.checker.typeRules),
    })),
  );
  if (completed === undefined) {
    return errorType;
  }
  const type = shape.typeOf(completed.typeArguments);
  for (const value of items.given.values()) {
    context.fit(
      value.type,
      substitute(value.declared, completed.substitution, context.checker.typeRules),
      value.node,
    );
  }
  if (spread !== undefined && spreadType !== undefined) {
    context.fit(spreadType, spreadOf(shape, completed.typeArguments), spread.node.expression);
  }
  const defaulted =
    spread === undefined ? defaultCalls(context, shape, items.given, completed.typeArguments) : [];
  reportMissing(context, items, type);
  const sources = sourcesOf({
    fields: shape.fields,
    given: new Map([...items.given].map(([index, { node: value }]) => [index, value])),
    spread:
      spread === undefined
        ? undefined
        : spreadGiven(context, spread, spreadOf(shape, completed.typeArguments)),
    defaulted,
  });
  if (items.fits && sources !== undefined) {
    context.literals.record(node, sources);
  }
  return type;
}

/** What a literal's leading `spread` gives: its value, and the fields of `type`, the type it spreads. */
function spreadGiven(
  context: BodyContext,
  spread: LiteralSpread,
  type: Type,
): LiteralGiven['spread'] {
  const names = (context.checker.fieldsOf(type) ?? []).map(({ name }) => name);
  return { from: spread.node.expression, names };
}

/**
 * The type arguments a literal of `owner` is given before its items: those written after the
 * type's name, else the expected type's when it is a type of `owner`.
 */
export function knownArguments(
  context: BodyContext,
  typeNode: NamedType,
  owner: Exclude<LiteralShape['owner'], undefined>,
  expected: Type | undefined,
): readonly Type[] | undefined {
  if (typeNode.typeArguments.length === 0) {
    return argumentsFor(owner, expected);
  }
  const written = typeNode.typeArguments.map((argument) => context.resolveType(argument));
  const list = { at: typeNode.span, declaration: owner, types: written };
  return typeArgumentsFor(context.checker, context.module, list);
}

/** The type arguments of `type` when it is a type of `owner`; else undefined. */
function argumentsFor(
  owner: LiteralShape['owner'],
  type: Type | undefined,
): readonly Type[] | undefined {
  const alias = type?.alias;
  if (alias?.kind === 'alias' && alias.declaration === owner) {
    return alias.arguments;
  }
  return type?.kind === 'nominal' && type.entity.declaration === owner ? type.arguments : undefined;
}

/** The type arguments known before the items, written or expected; a spread's are inferred. */
function decidedArguments(
  { known }: LiteralShape,
  parameters: readonly ParameterKey[],
): Map<ParameterKey, Type> {
  const decided = new Map<ParameterKey, Type>();
  for (const [index, parameter] of parameters.entries()) {
    const type = known?.[index];
    if (type !== undefined) {
      decided.set(parameter, type);
    }
  }
  return decided;
}

/** The type a spread gives a literal of `shape`: its own, or a shared struct's value (§3.18). */
function spreadOf(shape: LiteralShape, typeArguments: readonly Type[]): Type {
  return shape.spreadOf?.(typeArguments) ?? shape.typeOf(typeArguments);
}

/** The type arguments inference completed, constrained; undefined after a report. */
function complete(
  context: BodyContext,
  node: FieldsLiteral,
  { owner }: LiteralShape,
  inference: Inference,
): { typeArguments: readonly Type[]; substitution: Substitution } | undefined {
  if (owner === undefined) {
    return { typeArguments: [], substitution: new Map() };
  }
  const parameters = typeParametersOf(owner.typeParameters);
  const completion = completeInference(context.checker, owner, parameters, inference);
  if (completion.kind === 'open') {
    const parameter = completion.parameter.name.text;
    context.report(checkerDiagnostics.cannotInfer(node.span, owner.name.text, parameter));
    return undefined;
  }
  const { typeArguments } = completion;
  constrainArguments(context.checker, context.module, {
    at: node.span,
    declaration: owner,
    types: typeArguments,
  });
  return completion;
}

/** What checking a literal's items keeps track of. */
interface LiteralItems {
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
function checkItem(
  context: BodyContext,
  items: LiteralItems,
  item: FieldsLiteral['items'][number],
  spread: Spread | undefined,
): void {
  if (item.kind === 'Invalid' || item === spread) {
    return;
  }
  if (item.kind === 'Spread') {
    const isVariant = items.shape.owner?.kind === 'EnumDeclaration';
    const report = isVariant
      ? checkerDiagnostics.variantSpread
      : checkerDiagnostics.misplacedSpread;
    context.report(report(item.span));
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
 * called for these type arguments is reported where they are checked, not as a missing field.
 */
function reportMissing(
  context: BodyContext,
  { node, shape, given }: LiteralItems,
  type: Type,
): void {
  const named = node.items.every(
    (item) => item.kind === 'FieldInitializer' || item.kind === 'Invalid',
  );
  if (!named) {
    return;
  }
  const at = node.type?.span ?? node.span;
  for (const [index, field] of shape.fields.entries()) {
    if (!(given.has(index) || declaresDefault(shape, index))) {
      context.report(checkerDiagnostics.missingField(at, typeText(type), field.name));
    }
  }
}

/** Whether field `index` of `shape` declares a default (§3.1). */
function declaresDefault({ fields }: LiteralShape, index: number): boolean {
  const declared = fields[index]?.declared?.node;
  return declared !== undefined && hasDefault(declared);
}

/**
 * By field position, for each field the literal leaves out, the call of `shape`'s defaults with the
 * literal's `typeArguments`, whose default for that field gives it. Its parameters are the fields
 * in order, so they are numbered as the shape's fields are (syntax/field-defaults.ts).
 */
function defaultCalls(
  context: BodyContext,
  shape: LiteralShape,
  given: ReadonlyMap<number, GivenField>,
  typeArguments: readonly Type[],
): readonly (FunctionCall | undefined)[] {
  const { defaults, fields } = shape;
  const isLeftOut = (index: number) => !given.has(index) && declaresDefault(shape, index);
  if (defaults === undefined || !fields.some((_, index) => isLeftOut(index))) {
    return [];
  }
  const candidates = [{ declaration: defaults }];
  const call = callWithTypes(context.checker, candidates, typeArguments);
  return fields.map((_, index) => (isLeftOut(index) ? call : undefined));
}

function literalName(node: FieldsLiteral): string {
  return node.type === undefined ? 'struct' : lastName(node.type.path).text;
}
