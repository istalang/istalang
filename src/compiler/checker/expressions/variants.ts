/**
 * Enum variants and `none` as values (§3.11), and names of types in value position.
 *
 * - A bare variant (`Expired`, `Ok{value: 1}`) needs an enum type to be expected that has it; a
 *   qualified one (`Decision.Expired`) names its enum, whose type arguments come from the expected
 *   type when it is the same enum, else from the fields and defaults (literal-fields.ts).
 * - `none` needs an optional type to be expected (§3.11).
 * - A variant with fields is built with braces; naming it bare is an error.
 * - Where a call's chosen function decides an argument's type, `none` and a bare variant wait for
 *   it (§3.5), so `f(none)` reads like `const x: T? = none`.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { Entity, VariantNaming } from '../../binder/entities.ts';
import { type EnumDeclaration, typeParametersOf } from '../../syntax/declarations.ts';
import type { FieldsLiteral, MemberAccess, NoneLiteral } from '../../syntax/expressions/index.ts';
import { fieldsFunctionOf } from '../../syntax/field-defaults.ts';
import { type Identifier, lastName } from '../../syntax/node.ts';
import type { Accepts, BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { chooseVariant } from '../resolution/named.ts';
import { enumsExpected, optionalInner, sameEnum } from '../types/fit.ts';
import { typeArgumentsFor } from '../types/resolve-type.ts';
import {
  errorType,
  expectsError,
  type NominalType,
  nominalType,
  type Type,
} from '../types/type.ts';
import { checkLiteralFields, knownArguments } from './literal-fields.ts';

/** A node naming a variant: bare, qualified, or as a literal's type. */
type VariantNode = Identifier | MemberAccess | FieldsLiteral;

/** The types `none` can take, as an argument a call's chosen function decides: any optional. */
export function noneAccepted(context: BodyContext): Accepts {
  return (expected) => optionalInner(expected, context.checker.optionalEntity) !== undefined;
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
    checker.inputs.variantNamed(naming.name, enumsExpected(checker, expected)) !== undefined;
}

export function checkNone(
  context: BodyContext,
  node: NoneLiteral,
  expected: Type | undefined,
): Type {
  const { optionalEntity } = context.checker;
  if (expected !== undefined && optionalInner(expected, optionalEntity) !== undefined) {
    return expected;
  }
  if (expectsError(expected)) {
    return errorType;
  }
  context.report(checkerDiagnostics.noneNeedsType(node.span));
  return errorType;
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
  return enumTypeFor(context, node, chosen.enum, expected);
}

/** The type of a variant built with braces: `Rejected{by: "legal"}`. */
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
  const target = sameEnum(checker, expected, chosen.enum);
  const fields = checker
    .declaredVariantsOf(chosen.enum)
    .find((candidate) => candidate.name === chosen.variant.name.text)?.fields;
  const shape = {
    owner: chosen.enum,
    defaults: fieldsFunctionOf(chosen.enum, chosen.variant),
    known: knownArguments(context, typeNode, chosen.enum, target),
    fields: fields ?? [],
    typeOf: (typeArguments: readonly Type[]) => enumType(context, chosen.enum, typeArguments),
  };
  return checkLiteralFields(context, node, shape);
}

/** The enum type a fieldless variant has: the expected one, or one from the defaults. */
function enumTypeFor(
  context: BodyContext,
  node: VariantNode,
  declaration: EnumDeclaration,
  expected: Type | undefined,
): Type {
  const same = sameEnum(context.checker, expected, declaration);
  if (same !== undefined) {
    return same;
  }
  if (expectsError(expected)) {
    return errorType;
  }
  const open = typeParametersOf(declaration.typeParameters).find(
    (parameter) => parameter.defaultType === undefined,
  );
  if (open !== undefined) {
    context.report(
      checkerDiagnostics.cannotInfer(node.span, declaration.name.text, open.name.text),
    );
    return errorType;
  }
  const list = { at: node.span, declaration, types: [] };
  const typeArguments = typeArgumentsFor(context.checker, context.module, list);
  return typeArguments === undefined ? errorType : enumType(context, declaration, typeArguments);
}

function enumType(
  context: BodyContext,
  declaration: EnumDeclaration,
  typeArguments: readonly Type[],
): NominalType {
  const { checker } = context;
  const entity = checker.bindings.entityOf(checker.moduleOf(declaration), declaration.name);
  if (entity?.kind !== 'type') {
    unreachable(`Enum '${declaration.name.text}' has no type entity.`);
  }
  return nominalType(entity, typeArguments);
}
