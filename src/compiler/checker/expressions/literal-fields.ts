/**
 * The fields of a struct or variant literal (§3.1, §3.11), the one path both are built through.
 *
 * - Every field is given exactly once, each value fitting the field's type.
 * - A generic type's arguments are written, taken from the expected type when it is the same
 *   type, or inferred from the values (§3.5): a value whose field type is already known is checked
 *   against it, any other is checked on its own and matched. Defaults fill what is left; anything
 *   still open can't be inferred.
 * - The other literal forms (shorthand, positional, spread) are reported as not supported until
 *   the feature that adds them.
 */

import type { EnumDeclaration, StructDeclaration } from '../../syntax/declarations.ts';
import type { Expression, StructLiteral } from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import type { FieldMember } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { constrainArguments, typeParametersOf } from '../declarations/resolve-type.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { completeInference } from '../inference/complete.ts';
import { Inference } from '../inference/infer.ts';
import {
  errorType,
  type NominalType,
  type ParameterKey,
  parametersIn,
  substitute,
  type Type,
} from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** What a literal builds: its generic declaration, its fields as declared, and how to name the type. */
export interface LiteralShape {
  readonly owner: StructDeclaration | EnumDeclaration;
  readonly fields: readonly FieldMember[];
  readonly typeOf: (typeArguments: readonly Type[]) => NominalType;
}

/** A field given a value: the value, its type, and the field's type as declared. */
interface GivenField {
  readonly node: Expression;
  readonly type: Type;
  readonly declared: Type;
}

/**
 * Checks `node`'s fields against `shape`; the literal's type. `known` are the type arguments
 * already decided, written or expected.
 */
export function checkLiteralFields(
  context: BodyContext,
  node: StructLiteral,
  shape: LiteralShape,
  known: readonly Type[] | undefined,
): Type {
  const parameters = typeParametersOf(shape.owner.typeParameters);
  const decided = new Map<ParameterKey, Type>();
  parameters.forEach((parameter, index) => {
    const type = known?.[index];
    if (type !== undefined) {
      decided.set(parameter, type);
    }
  });
  const inference = new Inference(parameters, context.checker.optionalEntity, decided);
  const given = new Map<string, GivenField>();
  for (const item of node.items) {
    const field = checkItem(context, { node, shape, inference, given }, item);
    if (field !== undefined) {
      given.set(field.name, field.given);
    }
  }
  const completion = completeInference(context.checker, shape.owner, parameters, inference);
  if (completion.kind === 'open') {
    const parameter = completion.parameter.name.text;
    context.report(checkerDiagnostics.cannotInfer(node.span, shape.owner.name.text, parameter));
    return errorType;
  }
  const { typeArguments, substitution } = completion;
  const type = shape.typeOf(typeArguments);
  const list = { at: node.span, declaration: shape.owner, types: typeArguments };
  constrainArguments(context.checker, context.module, list);
  for (const value of given.values()) {
    context.fit(value.type, substitute(value.declared, substitution), value.node);
  }
  const at = node.type?.span ?? node.span;
  for (const field of shape.fields.filter((candidate) => !given.has(candidate.name))) {
    context.report(checkerDiagnostics.missingField(at, typeText(type), field.name));
  }
  return type;
}

/** What checking a literal's items keeps track of. */
interface LiteralItems {
  readonly node: StructLiteral;
  readonly shape: LiteralShape;
  readonly inference: Inference;
  readonly given: ReadonlyMap<string, GivenField>;
}

/**
 * Checks one item of a literal: its value against its field's type when that is already known,
 * else on its own, matched for inference. The field it gives, unless it gives none.
 */
function checkItem(
  context: BodyContext,
  { node, shape, inference, given }: LiteralItems,
  item: StructLiteral['items'][number],
): { name: string; given: GivenField } | undefined {
  if (item.kind === 'Invalid') {
    return undefined;
  }
  if (item.kind !== 'FieldInitializer' || item.value === undefined) {
    const construct = item.kind === 'FieldInitializer' ? frontier.shorthandField : undefined;
    context.unsupported(item, construct);
    return undefined;
  }
  const field = shape.fields.find((candidate) => candidate.name === item.name.text);
  if (field === undefined || given.has(field.name)) {
    context.report(
      field === undefined
        ? checkerDiagnostics.unknownField(item.name.span, literalName(node), item.name.text)
        : checkerDiagnostics.repeatedField(item.name.span, field.name),
    );
    context.expression(item.value);
    return undefined;
  }
  const declared = substitute(field.type, inference.substitution());
  const isKnown = parametersIn(declared).every((parameter) => !inference.isUnknown(parameter));
  const type = context.expression(item.value, isKnown ? declared : undefined);
  if (!isKnown) {
    inference.match(field.type, type);
  }
  return { name: field.name, given: { node: item.value, type, declared: field.type } };
}

function literalName(node: StructLiteral): string {
  return node.type === undefined ? 'struct' : lastName(node.type.path).text;
}
