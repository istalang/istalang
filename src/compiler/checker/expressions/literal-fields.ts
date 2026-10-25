/**
 * The fields of a struct or variant literal (§3.1, §3.11), the one path both are built through,
 * and where each field's value comes from, which the checker records for later phases.
 *
 * - Every field is given exactly once, each value fitting the field's type, by the one rule of
 *   which field an item gives (rules/struct-items.ts): by name, by the shorthand `first` for
 *   `first: first`, or positionally when there is one field. With names alone, every field must
 *   be given; a struct literal's leading spread gives the rest, and a positional value is the only
 *   item (the parser enforces that), so neither leaves fields to report as missing. A variant
 *   can't be spread into: which variant a value holds isn't known when compiling.
 * - A generic type's arguments are written, taken from the expected type or the spread value when
 *   it is the same type, or inferred from the values (§3.5): a value whose field type is already
 *   known is checked against it, any other is checked on its own and matched. Defaults fill what
 *   is left; anything still open can't be inferred. An anonymous struct has no type parameters.
 * - What each field's value comes from is recorded per literal, in declaration order, so lowering
 *   and compile time read it rather than reading the items again. A literal with a mistake in its
 *   items has no record: nothing compiles it.
 * - An `Error` may leave out `trace` (§3.12): the runtime writes it from the frames where the
 *   `Error` is built, through the prelude extern the literal is recorded as calling.
 */

import { errorTrace, wellKnown } from '../../../language/well-known.ts';
import type { EnumDeclaration, StructDeclaration } from '../../syntax/declarations.ts';
import {
  type Expression,
  type FieldItem,
  itemValue,
  type Spread,
  type StructLiteral,
} from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import type { FieldSource } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { constrainArguments, typeParametersOf } from '../declarations/resolve-type.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { completeInference } from '../inference/complete.ts';
import { Inference } from '../inference/infer.ts';
import { callMade } from '../overloads/calls-made.ts';
import { itemField } from '../rules/struct-items.ts';
import {
  errorType,
  type FieldMember,
  type ParameterKey,
  parametersIn,
  type Substitution,
  substitute,
  type Type,
} from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { useSite } from '../use-site.ts';

/**
 * What a literal builds: its fields as declared, how to name its type from type arguments, and
 * the generic declaration they belong to, absent for an anonymous struct.
 */
export interface LiteralShape {
  readonly owner: StructDeclaration | EnumDeclaration | undefined;
  /** The type arguments already decided, written or expected. */
  readonly known: readonly Type[] | undefined;
  readonly fields: readonly FieldMember[];
  readonly typeOf: (typeArguments: readonly Type[]) => Type;
}

/** A struct literal's leading spread, and its type when the caller checked it already. */
export interface LiteralSpread {
  readonly node: Spread;
  readonly type?: Type;
}

/** The struct literals of one body, each with where its fields' values come from. */
export class StructLiterals {
  readonly #sources = new Map<StructLiteral, readonly FieldSource[]>();

  record(literal: StructLiteral, sources: readonly FieldSource[]): void {
    this.#sources.set(literal, sources);
  }

  sourcesOf(literal: StructLiteral): readonly FieldSource[] | undefined {
    return this.#sources.get(literal);
  }
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
  node: StructLiteral,
  shape: LiteralShape,
  spread?: LiteralSpread,
): Type {
  const spreadType =
    spread === undefined ? undefined : (spread.type ?? context.expression(spread.node.expression));
  const parameters = shape.owner === undefined ? [] : typeParametersOf(shape.owner.typeParameters);
  const decided = decidedArguments(shape, parameters, spreadType);
  const inference = new Inference(parameters, context.checker.optionalEntity, decided);
  const items: LiteralItems = { node, shape, inference, given: new Map(), fits: true };
  for (const item of node.items) {
    checkItem(context, items, item, spread?.node);
  }
  const completed = complete(context, node, shape, inference);
  if (completed === undefined) {
    return errorType;
  }
  const type = shape.typeOf(completed.typeArguments);
  for (const value of items.given.values()) {
    context.fit(value.type, substitute(value.declared, completed.substitution), value.node);
  }
  if (spread !== undefined && spreadType !== undefined) {
    context.fit(spreadType, type, spread.node.expression);
  }
  const traced = tracedField(context, node, shape, items.given);
  reportMissing(context, items, type, traced);
  const sources = sourcesOf(shape, items.given, spread, traced);
  if (items.fits && sources !== undefined) {
    context.literals.record(node, sources);
  }
  return type;
}

/** The type arguments known before the items: written or expected, else the spread's. */
function decidedArguments(
  { owner, known }: LiteralShape,
  parameters: readonly ParameterKey[],
  spreadType: Type | undefined,
): Map<ParameterKey, Type> {
  const fromSpread =
    spreadType?.kind === 'nominal' && spreadType.entity.declaration === owner
      ? spreadType.arguments
      : undefined;
  const decided = new Map<ParameterKey, Type>();
  for (const [index, parameter] of parameters.entries()) {
    const type = known?.[index] ?? fromSpread?.[index];
    if (type !== undefined) {
      decided.set(parameter, type);
    }
  }
  return decided;
}

/** The type arguments inference completed, constrained; undefined after a report. */
function complete(
  context: BodyContext,
  node: StructLiteral,
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
  readonly node: StructLiteral;
  readonly shape: LiteralShape;
  readonly inference: Inference;
  /** The fields given so far, by position in the shape. */
  readonly given: Map<number, GivenField>;
  /** Whether every item so far gave a field of its own. */
  fits: boolean;
}

/**
 * Checks one item of a literal: its value against its field's type when that is already known,
 * else on its own, matched for inference.
 */
function checkItem(
  context: BodyContext,
  items: LiteralItems,
  item: StructLiteral['items'][number],
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
  const index = itemField(item, shape.fields);
  const field = shape.fields[index];
  const value = itemValue(item);
  if (field === undefined || given.has(index)) {
    reportMisfit(context, items, item, field);
    context.expression(value);
    items.fits = false;
    return;
  }
  const declared = substitute(field.type, inference.substitution());
  const isKnown = parametersIn(declared).every((parameter) => !inference.isUnknown(parameter));
  const type = context.expression(value, isKnown ? declared : undefined);
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

/** With names alone, a field no item names is missing, unless the runtime writes it (`traced`). */
function reportMissing(
  context: BodyContext,
  { node, shape, given }: LiteralItems,
  type: Type,
  traced: number | undefined,
): void {
  const named = node.items.every(
    (item) => item.kind === 'FieldInitializer' || item.kind === 'Invalid',
  );
  if (!named) {
    return;
  }
  const at = node.type?.span ?? node.span;
  for (const [index, field] of shape.fields.entries()) {
    if (!given.has(index) && index !== traced) {
      context.report(checkerDiagnostics.missingField(at, typeText(type), field.name));
    }
  }
}

/**
 * Each field's source in declaration order, the spread giving the rest and the runtime the
 * `traced` field; undefined if one has none.
 */
function sourcesOf(
  { fields }: LiteralShape,
  given: ReadonlyMap<number, GivenField>,
  spread: LiteralSpread | undefined,
  traced: number | undefined,
): readonly FieldSource[] | undefined {
  const sources: FieldSource[] = [];
  for (const index of fields.keys()) {
    const source = sourceOf(index, given.get(index)?.node, spread, traced);
    if (source === undefined) {
      return undefined;
    }
    sources.push(source);
  }
  return sources;
}

/** Where field `index` gets its value: the literal's `value`, the spread, or the runtime. */
function sourceOf(
  index: number,
  value: Expression | undefined,
  spread: LiteralSpread | undefined,
  traced: number | undefined,
): FieldSource | undefined {
  if (value !== undefined) {
    return { kind: 'value', value };
  }
  if (spread !== undefined) {
    return { kind: 'spread', from: spread.node.expression, index };
  }
  return index === traced ? { kind: 'trace' } : undefined;
}

/**
 * The index of an `Error`'s `trace` when the literal leaves it to the runtime, which it then
 * records as calling the prelude extern that writes it (§3.12); undefined for any other literal.
 */
function tracedField(
  context: BodyContext,
  node: StructLiteral,
  shape: LiteralShape,
  given: ReadonlyMap<number, GivenField>,
): number | undefined {
  const error = context.checker.wellKnownType(wellKnown.error);
  const index = shape.fields.findIndex((field) => field.name === errorTrace.field);
  const isError = error?.kind === 'nominal' && shape.owner === error.entity.declaration;
  const [writer] = context.checker.preludeFunctions(errorTrace.function);
  if (!isError || index < 0 || given.has(index) || writer === undefined) {
    return undefined;
  }
  const call = callMade(
    useSite(context.checker, context.module, node.span),
    { declaration: writer },
    { typeArguments: [], witnesses: new Map() },
    0,
  );
  if (call !== undefined) {
    context.recordCall(node, call);
  }
  return index;
}

function literalName(node: StructLiteral): string {
  return node.type === undefined ? 'struct' : lastName(node.type.path).text;
}
