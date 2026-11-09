/**
 * The fields of a struct literal (§3.1), and where each field's value comes from, which the
 * checker records for later phases. A variant is built by its call, never in braces (§3.11).
 *
 * - Every field is given exactly once, each value fitting the field's type, by the one rule of
 *   which field an item gives (items.ts, struct-items.ts): by name, by the shorthand `first` for
 *   `first: first`, or positionally when a struct has one field. With names alone, every field
 *   must be given, but for those with a default; a struct literal's leading spread gives the rest,
 *   and a positional value is the only item (the parser enforces that), so neither leaves fields to
 *   report as missing.
 * - A generic type's arguments are written, or inferred from the values and the spread value, the
 *   expected type advising, as a call's does (§3.5): a value whose field type is already known is
 *   checked against it, any other is checked expecting what its field's type is so far, and
 *   matched. Defaults fill what
 *   is left; anything still open can't be inferred. A shape has no type parameters, but an alias
 *   naming one may (§3.17), and a literal through it infers them as a struct's.
 * - A literal is a member of the constraint scope it stands in (wiring/body/constraint-scope.ts): its
 *   items matched, it waits for the scope to settle before it is completed and anything is
 *   recorded.
 * - What each field's value comes from is recorded per literal, in declaration order
 *   (../literal-sources.ts), so lowering and compile time read it rather than reading the items
 *   again. A literal with a mistake in its items has no record: nothing compiles it.
 * - A field left out with names alone takes its default (§3.1), from that field's default of the
 *   function the declaration's fields read as (syntax/declarations/field-defaults.ts), instantiated
 *   with the literal's type arguments, its constraints met where the literal is. A spread gives
 *   every field, so a literal with one runs no default.
 */

import { typeParametersOf } from '../../../../../syntax/declarations/index.ts';
import type { FieldsLiteral } from '../../../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../../diagnostics/index.ts';
import { completeInference, settlingOf } from '../../../../types/inference/complete.ts';
import { Inference } from '../../../../types/inference/infer.ts';
import { type Settling, settlesFreely } from '../../../../types/inference/settle.ts';
import { type Substitution, substitute } from '../../../../types/parts/substitution.ts';
import type { ParameterKey, Type } from '../../../../types/type/index.ts';
import { errorType } from '../../../../types/type/primitives.ts';
import { typeText } from '../../../../types/type/type-text.ts';
import { givenKeysOwner } from '../../../../types/written/key-types.ts';
import { parameterType } from '../../../../types/written/resolve-type.ts';
import { constrainArguments } from '../../../../types/written/type-arguments.ts';
import { type LiteralGiven, sourcesOf } from '../literal-sources.ts';
import {
  type Comprehended,
  checkComprehended,
  comprehendedGiven,
  fitComprehended,
} from '../struct-comprehensions.ts';
import {
  checkItem,
  defaultCalls,
  type LiteralItems,
  type LiteralShape,
  type LiteralSpread,
  literalName,
  reportMissing,
} from './items.ts';

/** Where a literal stands beside its shape: its leading spread, and what it is expected to be. */
export interface LiteralSetting {
  readonly spread?: LiteralSpread | undefined;
  /** What it is expected to be, which advises its type arguments as a call's does (§3.5). */
  readonly expected?: Type | undefined;
  /** Whether its values were checked already (items.ts `LiteralItems.checked`). */
  readonly checked?: boolean | undefined;
}

/**
 * Checks `node`'s items against `shape`, in the current constraint scope: the literal's type, open
 * until the scope settles (wiring/body/constraint-scope.ts).
 */
export function checkLiteralFields(
  context: BodyContext,
  node: FieldsLiteral,
  shape: LiteralShape,
  { spread, expected, checked = false }: LiteralSetting = {},
): Type {
  const { checker } = context;
  const spreadType =
    spread === undefined ? undefined : (spread.type ?? context.expression(spread.node.expression));
  const parameters = shape.owner === undefined ? [] : typeParametersOf(shape.owner.typeParameters);
  const decided = decidedArguments(shape, parameters);
  const inference = new Inference(parameters, checker.fitting, decided, { site: node });
  context.scopes.commit(inference);
  if (
    spreadType !== undefined &&
    !inference.match(spreadOf(shape, parameters.map(parameterType)), spreadType)
  ) {
    context.scopes.abandon([spreadType]);
  }
  const items: LiteralItems = {
    node,
    shape,
    inference,
    given: new Map(),
    checked,
    fits: true,
  };
  for (const item of node.items) {
    checkItem(context, items, item, spread?.node);
  }
  // As a call's, once what its items give is bound, so it is checked against them (§3.5).
  inference.expect(shape.typeOf(parameters.map(parameterType)), expected);
  const comprehended = checkComprehended(context, node, {
    fields: shape.fields,
    name: literalName(node),
    inference,
    isGiven: (index) => items.given.has(index),
  });
  const settling =
    shape.owner === undefined ? settlesFreely : settlingOf(checker, shape.owner, parameters);
  const literal = { items, comprehended, spread, spreadType, settling };
  return context.scopes.join({
    node,
    inference,
    type: inference.open(shape.typeOf(parameters.map(parameterType))),
    settling,
    complete: () => completeLiteral(context, literal),
  });
}

/** What checking a literal's items found, to complete it with once its system settles. */
interface CheckedLiteral {
  readonly items: LiteralItems;
  readonly comprehended: Comprehended | undefined;
  readonly spread: LiteralSpread | undefined;
  readonly spreadType: Type | undefined;
  readonly settling: Settling;
}

/** Completes a literal once its system settles, recording what it builds; its type. */
function completeLiteral(context: BodyContext, checked: CheckedLiteral): Type {
  const { items, comprehended, spread, spreadType, settling } = checked;
  const { node, shape, inference } = items;
  const completed = complete(context, items, settling);
  const found = completed?.substitution ?? inference.solution();
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
  // A shape taken from what is expected may name what its scope solved (wiring/body/constraint-scope.ts).
  const type = inference.solved(shape.typeOf(completed.typeArguments));
  fitItems(context, items, completed.substitution);
  if (spread !== undefined && spreadType !== undefined) {
    context.fit(
      inference.solved(spreadType),
      spreadOf(shape, completed.typeArguments),
      spread.node.expression,
    );
  }
  fitComprehended(context, comprehended, completed.substitution);
  const comprehendedFields = comprehendedGiven(comprehended);
  const defaulted =
    spread === undefined && comprehended === undefined
      ? defaultCalls(context, shape, items.given, completed.typeArguments)
      : [];
  reportMissing(context, items, type, comprehendedFields?.indices);
  const sources = sourcesOf({
    fields: shape.fields,
    given: new Map([...items.given].map(([index, { node: value }]) => [index, value])),
    spread:
      spread === undefined
        ? undefined
        : spreadGiven(context, spread, spreadOf(shape, completed.typeArguments)),
    defaulted,
    comprehended: comprehendedFields,
  });
  if (items.fits && sources !== undefined) {
    context.literals.record(node, sources);
  }
  return type;
}

/**
 * Fits each named item's value to its field, `substitution` giving the literal's type arguments; a
 * written literal checked again as its field's type then reads it (§2), and any other value has
 * its type as the scope settled it.
 */
function fitItems(
  context: BodyContext,
  { given, inference }: LiteralItems,
  substitution: Substitution,
): void {
  for (const value of given.values()) {
    const declared = inference.solved(
      substitute(value.declared, substitution, context.checker.typeRules),
    );
    const type = value.isLiteral
      ? context.expression(value.node, declared)
      : inference.solved(value.type);
    context.fit(type, declared, value.node);
    context.recordKey(
      value.node,
      givenKeysOwner(context.checker.fitting, value.declared, substitution),
    );
  }
}

/**
 * What a literal's leading `spread` gives: its value, and the fields of `type`, the type it
 * spreads.
 */
function spreadGiven(
  context: BodyContext,
  spread: LiteralSpread,
  type: Type,
): LiteralGiven['spread'] {
  const names = (context.checker.fieldsOf(type) ?? []).map(({ name }) => name);
  return { from: spread.node.expression, names };
}

/** The type arguments known before the items, written; a spread's are inferred. */
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

/**
 * The type arguments inference completed, constrained; undefined after a report, or, after an item
 * giving no field was reported, where what it would have inferred is missing, which isn't again.
 */
function complete(
  context: BodyContext,
  { node, shape, inference, fits }: LiteralItems,
  settling: Settling,
): { typeArguments: readonly Type[]; substitution: Substitution } | undefined {
  const { owner, expected } = shape;
  if (owner === undefined) {
    return { typeArguments: [], substitution: new Map() };
  }
  const parameters = typeParametersOf(owner.typeParameters);
  const completion = completeInference(context.checker, parameters, inference, settling);
  if (completion.kind === 'open' && !fits) {
    return undefined;
  }
  if (completion.kind === 'open' && expected !== undefined) {
    const found = inference.solution();
    const given = shape.typeOf(parameters.map((parameter) => found.get(parameter) ?? errorType));
    context.report(checkerDiagnostics.typeMismatch(node.span, typeText(expected), typeText(given)));
    return undefined;
  }
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
