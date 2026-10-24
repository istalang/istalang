/**
 * Enum variants and `none` as values (§3.11), and names of types in value position.
 *
 * - A bare variant (`Expired`, `Ok{value: 1}`) needs an enum type to be expected that has it; a
 *   qualified one (`Decision.Expired`) names its enum, whose type arguments come from the expected
 *   type when it is the same enum, else from the fields and defaults (literal-fields.ts).
 * - `none` needs an optional type to be expected (§3.11).
 * - A variant with fields is built with braces; naming it bare is an error.
 * - Where a call's chosen function decides an argument's type, these are the arguments that wait
 *   for it (`decidedByCall`), so `f(none)` reads like `const x: T? = none`.
 */

import type { Entity, VariantEntity } from '../../binder/entities.ts';
import type { EnumDeclaration, Variant } from '../../syntax/declarations.ts';
import type {
  Expression,
  MemberAccess,
  NoneLiteral,
  StructLiteral,
} from '../../syntax/expressions.ts';
import { type Identifier, lastName } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { parameterType, typeArgumentsFor, typeParametersOf } from '../declarations/resolve-type.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { optionalInner } from '../types/fit.ts';
import { errorType, type NominalType, primitiveType, type Type } from '../types/type.ts';
import { checkLiteralFields } from './literal-fields.ts';

/** What a name denotes when it names variants: one, qualified, or the candidates of a bare name. */
type VariantNaming = Extract<Entity, { kind: 'variant' | 'variants' }>;

/** A node naming a variant: bare, qualified, or as a literal's type. */
type VariantNode = Identifier | MemberAccess | StructLiteral;

/**
 * When a call's chosen function decides the type of `node` (`none`, a bare variant), which
 * parameter types it can take, so choosing can rule out the rest; undefined for any other node,
 * whose own type takes part in choosing.
 */
export function decidedByCall(
  context: BodyContext,
  node: Expression,
): ((expected: Type) => boolean) | undefined {
  switch (node.kind) {
    case 'NoneLiteral':
      return (expected) => optionalInner(expected, context.checker.optionalEntity) !== undefined;
    case 'Parenthesized':
      return decidedByCall(context, node.expression);
    case 'Identifier':
      return variantsAccepted(context, context.entityOf(node));
    case 'StructLiteral':
      return node.type === undefined
        ? undefined
        : variantsAccepted(context, context.entityOf(lastName(node.type.path)));
    default:
      return undefined;
  }
}

/** For a bare variant's name, the enum types that have a variant of that name. */
function variantsAccepted(
  context: BodyContext,
  naming: Entity | undefined,
): ((expected: Type) => boolean) | undefined {
  if (naming?.kind !== 'variants') {
    return undefined;
  }
  const candidates = context.checker.bindings.candidatesOf(naming);
  return (expected) =>
    candidates.some((candidate) => sameEnum(expected, candidate.enum) !== undefined);
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
  const chosen = chooseVariant(context, node, naming, expected);
  if (chosen === undefined) {
    return errorType;
  }
  if (chosen.variant.fields.length > 0) {
    context.report(checkerDiagnostics.variantFields(node.span, nameOf(node)));
    return errorType;
  }
  return enumTypeFor(context, node, chosen.enum, expected);
}

/** The type of a variant built with braces: `Rejected{by: "legal"}`. */
export function checkVariantLiteral(
  context: BodyContext,
  node: StructLiteral,
  naming: VariantNaming,
  expected: Type | undefined,
): Type {
  const typeNode = node.type;
  const chosen = chooseVariant(context, node, naming, expected);
  if (chosen === undefined || typeNode === undefined) {
    return errorType;
  }
  const { checker } = context;
  const fields = checker
    .declaredVariantsOf(chosen.enum)
    .find((candidate) => candidate.name === chosen.variant.name.text)?.fields;
  const written = typeNode.typeArguments.map((argument) => context.resolveType(argument));
  const list = { at: typeNode.span, declaration: chosen.enum, types: written };
  const known =
    written.length > 0
      ? typeArgumentsFor(checker, context.module, list)
      : sameEnum(expected, chosen.enum)?.arguments;
  const shape = {
    owner: chosen.enum,
    known,
    fields: fields ?? [],
    typeOf: (typeArguments: readonly Type[]) => enumType(context, chosen.enum, typeArguments),
  };
  return checkLiteralFields(context, node, shape);
}

/**
 * The type a type named in value position denotes, as the owner of a static call or the target
 * of a conversion; undefined when `node` names no type.
 */
export function namedType(context: BodyContext, node: Expression): Type | undefined {
  const name = nameNodeOf(node);
  const entity = name === undefined ? undefined : context.entityOf(name);
  if (entity?.kind === 'primitive') {
    return primitiveType(entity.name);
  }
  if (entity?.kind !== 'type') {
    return undefined;
  }
  const { declaration } = entity;
  switch (declaration.kind) {
    case 'TypeParameter':
      return parameterType(declaration);
    case 'TypeAliasDeclaration':
      return context.checker.aliasedType(declaration);
    case 'TraitDeclaration':
      return undefined;
    default:
      return { kind: 'nominal', entity: entity as NominalType['entity'], arguments: [] };
  }
}

/** The identifier naming what `node` names: itself, or the member of a qualified name. */
function nameNodeOf(node: Expression): Identifier | undefined {
  if (node.kind === 'Identifier') {
    return node;
  }
  return node.kind === 'MemberAccess' ? node.member : undefined;
}

/** The variant name `node` is written with. */
function nameOf(node: VariantNode): string {
  switch (node.kind) {
    case 'Identifier':
      return node.text;
    case 'MemberAccess':
      return node.member.text;
    default:
      return node.type === undefined ? '' : lastName(node.type.path).text;
  }
}

/** The variant a name means: the one its qualification names, or the one the expected enum has. */
function chooseVariant(
  context: BodyContext,
  node: VariantNode,
  naming: VariantNaming,
  expected: Type | undefined,
): { enum: EnumDeclaration; variant: Variant } | undefined {
  if (naming.kind === 'variant') {
    return { enum: naming.enum, variant: naming.variant };
  }
  const candidates: readonly VariantEntity[] = context.checker.bindings.candidatesOf(naming);
  const chosen = candidates.find((candidate) => sameEnum(expected, candidate.enum) !== undefined);
  if (chosen === undefined) {
    context.report(checkerDiagnostics.bareVariant(node.span, nameOf(node)));
    return undefined;
  }
  return { enum: chosen.enum, variant: chosen.variant };
}

/** The enum type a fieldless variant has: the expected one, or one from the defaults. */
function enumTypeFor(
  context: BodyContext,
  node: VariantNode,
  declaration: EnumDeclaration,
  expected: Type | undefined,
): Type {
  const same = sameEnum(expected, declaration);
  if (same !== undefined) {
    return same;
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

/** `expected`, when it is a type of `declaration`. */
function sameEnum(
  expected: Type | undefined,
  declaration: EnumDeclaration,
): NominalType | undefined {
  return expected?.kind === 'nominal' && expected.entity.declaration === declaration
    ? expected
    : undefined;
}

function enumType(
  context: BodyContext,
  declaration: EnumDeclaration,
  typeArguments: readonly Type[],
): NominalType {
  const { checker } = context;
  const entity = checker.bindings.entityOf(checker.moduleOf(declaration), declaration.name);
  return { kind: 'nominal', entity: entity as NominalType['entity'], arguments: typeArguments };
}
