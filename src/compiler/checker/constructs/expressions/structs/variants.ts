/**
 * Enum variants and `none` as values (§3.11), and names of types in value position.
 *
 * - A bare variant (`Expired`, `Ok(1)`) needs an enum type to be expected that has it; a qualified
 *   one (`Decision.Expired`) names its enum, whose type arguments come from the expected type when
 *   it is the same enum, else from the fields and defaults (literal-fields.ts).
 * - A variant with fields is a function of its enum, its constructor (§3.11,
 *   syntax/declarations/field-defaults.ts): a call binds its arguments to the fields as any call's
 *   to parameters (§3.3), and builds what the literal with those fields builds. Naming it bare is
 *   an error. A variant without fields is a value, so `Expired()` is `Expired`.
 * - A variant's fields are given in braces by name only: `Ok{42}` is written `Ok(42)`.
 * - `none` needs an optional type to be expected (§3.11).
 * - Where a call's chosen function decides an argument's type, `none`, a bare variant and a call
 *   of one wait for it (§3.5), so `f(none)` reads like `const x: T? = none`.
 */

import { staticName } from '../../../../../foundation/language/static-names.ts';
import type { Entity, VariantNaming } from '../../../../binder/entities.ts';
import { fieldsFunctionOf } from '../../../../syntax/declarations/field-defaults.ts';
import type { EnumDeclaration } from '../../../../syntax/declarations/index.ts';
import type {
  Call,
  Expression,
  FieldItem,
  FieldsLiteral,
  MemberAccess,
} from '../../../../syntax/expressions/index.ts';
import { itemValue, unparenthesized } from '../../../../syntax/expressions/readings.ts';
import { type Identifier, lastName } from '../../../../syntax/tree/node.ts';
import type { Accepts, BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { resolveCall, type WrittenArgument } from '../../../resolution/calls/resolve.ts';
import { enumsExpected, expectedNominal, sameNominal } from '../../../types/fitting/expected.ts';
import {
  type FieldMember,
  type NominalType,
  nominalType,
  type Type,
} from '../../../types/type/index.ts';
import { errorType, noneType } from '../../../types/type/primitives.ts';
import { chooseVariant, nominalEntityOf } from '../../../types/written/named-types.ts';
import { argumentsKnown, checkLiteralFields, knownArguments } from './literal-fields.ts';

/**
 * The types `none` can take, as an argument a call's chosen function decides: any it fits, a
 * union holding `None`, so a literal holding it, such as `(none, 1)`, is built from the parameter.
 */
export function noneAccepted(context: BodyContext): Accepts {
  return (expected) => context.checker.fitOf(noneType, expected) !== undefined;
}

/** For a bare variant's name, the enum types that have a variant of that name. */
export function variantsAccepted(
  context: BodyContext,
  naming: Entity | undefined,
): Accepts | undefined {
  if (naming?.kind !== 'variants') {
    return undefined;
  }
  const { checker } = context;
  return (expected) =>
    checker.inputs.variantNamed(naming.name, enumsExpected(expected)) !== undefined;
}

/** For a call of a bare variant, `Ok(v)`, the enum types that have a variant of that name. */
export function variantCallAccepts(context: BodyContext, node: Call): Accepts | undefined {
  return node.callee.kind === 'Identifier' && !node.isOptional
    ? variantsAccepted(context, context.entityOf(node.callee))
    : undefined;
}

/**
 * `none`, the one value of `None` (§2), whatever is expected: it goes into a union as its member.
 */
export function checkNone(): Type {
  return noneType;
}

/** The type of a variant named without fields, bare or qualified. */
export function checkVariantName(
  context: BodyContext,
  node: Identifier | MemberAccess,
  naming: VariantNaming,
  expected: Type | undefined,
): Type {
  const name = node.kind === 'Identifier' ? node : node.member;
  const chosen = chooseVariant(context, { span: node.span, name }, naming, expected);
  if (chosen === undefined) {
    return errorType;
  }
  if (chosen.variant.fields.length > 0) {
    context.report(checkerDiagnostics.variantFields(node.span, name.text));
    return errorType;
  }
  return expectedNominal(
    context,
    node.span,
    nominalEntityOf(context.checker, chosen.enum),
    expected,
  );
}

/** The name of the variant a call names, bare or qualified; undefined for any other call. */
export function calledVariant(context: BodyContext, node: Call): Identifier | undefined {
  const { callee } = node;
  const name = callee.kind === 'MemberAccess' ? callee.member : callee;
  if (name.kind !== 'Identifier') {
    return undefined;
  }
  const entity = context.entityOf(name);
  return entity?.kind === 'variant' || entity?.kind === 'variants' ? name : undefined;
}

/** A call naming a variant, as written: its arguments, any type arguments, what is expected. */
export interface VariantCall {
  readonly node: Call;
  readonly expected: Type | undefined;
  readonly typeArguments: readonly Type[] | undefined;
  readonly written: readonly WrittenArgument[];
}

/**
 * `Ok(v)`, `Verdict.Rejected(by: "legal")`: a call of the variant's constructor, chosen as any
 * call's function is, by its name `Enum.Variant`. Type arguments written at the call, or else the
 * expected type's when it is the variant's enum, are given before the arguments, as a literal's are
 * (literal-fields.ts `argumentsKnown`), so an argument fits its field as it would in the literal;
 * inference and defaults find the rest. A variant without fields is called with no arguments, as
 * the value it names.
 */
export function checkVariantCall(
  context: BodyContext,
  call: VariantCall,
  callee: Identifier | MemberAccess,
  naming: VariantNaming,
): Type {
  const name = callee.kind === 'Identifier' ? callee : callee.member;
  const chosen = chooseVariant(context, { span: callee.span, name }, naming, call.expected);
  if (chosen === undefined) {
    return errorType;
  }
  const written = { at: call.node.span, written: call.typeArguments ?? [] };
  const target = sameNominal(call.expected, chosen.enum);
  const known = argumentsKnown(context, written, chosen.enum, target);
  const qualified = staticName(chosen.enum.name.text, chosen.variant.name.text);
  const constructs = fieldsFunctionOf(chosen.enum, chosen.variant);
  if (constructs !== undefined) {
    return resolveCall(context, {
      site: call.node,
      name: qualified,
      candidates: [{ declaration: constructs }],
      arguments: call.written,
      typeArguments: known?.length === 0 ? undefined : known,
      expected: call.expected,
      form: 'call',
    });
  }
  if (call.written.length > 0) {
    const count = call.written.length;
    context.report(checkerDiagnostics.argumentCount(call.node.span, qualified, 0, count, false));
    return errorType;
  }
  const entity = nominalEntityOf(context.checker, chosen.enum);
  if (call.typeArguments === undefined) {
    return expectedNominal(context, callee.span, entity, call.expected);
  }
  return known === undefined ? errorType : nominalType(entity, known);
}

/**
 * The type of a variant built with braces, `Rejected{by: "legal"}`, whose fields are named: a
 * value given without its field's name is the call's (`Ok(42)`), and so is a shorthand naming no
 * field of a variant with one (`Ok{v}`), which reads as `Ok(v)` meant.
 */
export function checkVariantLiteral(
  context: BodyContext,
  node: FieldsLiteral,
  naming: VariantNaming,
  expected: Type | undefined,
): Type {
  const typeNode = node.type;
  if (typeNode === undefined) {
    return errorType;
  }
  const name = lastName(typeNode.path);
  const chosen = chooseVariant(context, { span: node.span, name }, naming, expected);
  if (chosen === undefined) {
    return errorType;
  }
  const { checker } = context;
  const target = sameNominal(expected, chosen.enum);
  const fields = checker
    .declaredVariantsOf(chosen.enum)
    .find((candidate) => candidate.name === chosen.variant.name.text)?.fields;
  const positional = positionalItem(node, fields ?? []);
  if (positional !== undefined) {
    const value = itemValue(positional);
    const text = simpleText(unparenthesized(value));
    context.report(checkerDiagnostics.variantByPosition(positional.span, name.text, text));
    context.expression(value);
    return errorType;
  }
  const shape = {
    owner: chosen.enum,
    defaults: fieldsFunctionOf(chosen.enum, chosen.variant),
    known: knownArguments(context, typeNode, chosen.enum, target),
    fields: fields ?? [],
    typeOf: (typeArguments: readonly Type[]) => enumType(context, chosen.enum, typeArguments),
  };
  return checkLiteralFields(context, node, shape);
}

/**
 * The one item of a variant literal giving its field by position, as a call does: a value without
 * a name, or a shorthand naming no field of a variant with one.
 */
function positionalItem(
  node: FieldsLiteral,
  fields: readonly FieldMember[],
): FieldItem | undefined {
  const [item, ...others] = node.items;
  if (item === undefined || others.length > 0) {
    return undefined;
  }
  if (item.kind === 'PositionalInitializer') {
    return item;
  }
  if (item.kind !== 'FieldInitializer' || item.value !== undefined || fields.length !== 1) {
    return undefined;
  }
  return fields.some((field) => field.name === item.name.text) ? undefined : item;
}

/** A value as a message writes it: a name or a literal as written, anything else elided. */
function simpleText(value: Expression): string {
  switch (value.kind) {
    case 'Identifier':
      return value.text;
    case 'IntegerLiteral':
    case 'BooleanLiteral':
      return String(value.value);
    default:
      return '…';
  }
}

function enumType(
  context: BodyContext,
  declaration: EnumDeclaration,
  typeArguments: readonly Type[],
): NominalType {
  return nominalType(nominalEntityOf(context.checker, declaration), typeArguments);
}
