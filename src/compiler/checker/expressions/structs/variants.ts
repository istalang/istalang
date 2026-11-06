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

import { unreachable } from '../../../../structures/unreachable.ts';
import type { Entity, VariantNaming } from '../../../binder/entities.ts';
import { fieldsFunctionOf } from '../../../syntax/declarations/field-defaults.ts';
import type { EnumDeclaration } from '../../../syntax/declarations/index.ts';
import type { FieldsLiteral, MemberAccess } from '../../../syntax/expressions/index.ts';
import { type Identifier, lastName } from '../../../syntax/node.ts';
import type { Accepts, BodyContext } from '../../body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { chooseVariant } from '../../resolution/named.ts';
import { enumsExpected, expectedNominal, sameNominal } from '../../types/fitting/expected.ts';
import {
  isNominalEntity,
  type NominalEntity,
  type NominalType,
  nominalType,
  type Type,
} from '../../types/type/index.ts';
import { errorType, noneType } from '../../types/type/primitives.ts';
import { checkLiteralFields, knownArguments } from './literal-fields.ts';

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
  return expectedNominal(context, node.span, enumEntity(context, chosen.enum), expected);
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
  const target = sameNominal(expected, chosen.enum);
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

function enumType(
  context: BodyContext,
  declaration: EnumDeclaration,
  typeArguments: readonly Type[],
): NominalType {
  return nominalType(enumEntity(context, declaration), typeArguments);
}

function enumEntity(context: BodyContext, declaration: EnumDeclaration): NominalEntity {
  const { checker } = context;
  const entity = checker.bindings.entityOf(checker.moduleOf(declaration), declaration.name);
  if (entity?.kind !== 'type' || !isNominalEntity(entity)) {
    unreachable(`Enum '${declaration.name.text}' has no type entity.`);
  }
  return entity;
}
