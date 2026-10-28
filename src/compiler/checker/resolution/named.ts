/**
 * What a name in value position names, where the binder alone can't tell (§3.1, §3.11): a type, as
 * the owner of a static call or a conversion's target; a variant, which a bare name picks by the
 * enum expected; or a struct without fields, the one type a bare name makes a value of. Expressions
 * and patterns name them the same way.
 */

import type { Span } from '../../../text/span.ts';
import type { Entity, VariantEntity, VariantNaming } from '../../binder/entities.ts';
import type { EnumDeclaration, StructDeclaration, Variant } from '../../syntax/declarations.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { BodyContext, CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { optionalInner } from '../types/fit.ts';
import { parameterType } from '../types/resolve-type.ts';
import { type NominalType, nominalType, primitiveType, type Type } from '../types/type.ts';

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
      return nominalType(entity, []);
  }
}

/** The identifier naming what `node` names: itself, or the member of a qualified name. */
export function nameNodeOf(node: Expression): Identifier | undefined {
  if (node.kind === 'Identifier') {
    return node;
  }
  return node.kind === 'MemberAccess' ? node.member : undefined;
}

/**
 * The variant a name written at `at` means: the one its qualification names, or the one the
 * expected enum has (§3.11). A pattern names a variant the same way, its value's type expected.
 */
export function chooseVariant(
  context: BodyContext,
  at: { readonly span: Span; readonly name: string },
  naming: VariantNaming,
  expected: Type | undefined,
): { enum: EnumDeclaration; variant: Variant } | undefined {
  if (naming.kind === 'variant') {
    return { enum: naming.enum, variant: naming.variant };
  }
  const candidates: readonly VariantEntity[] = context.checker.bindings.candidatesOf(naming);
  const chosen = candidates.find(
    (candidate) => sameEnum(context.checker, expected, candidate.enum) !== undefined,
  );
  if (chosen === undefined) {
    context.report(checkerDiagnostics.bareVariant(at.span, at.name));
    return undefined;
  }
  return { enum: chosen.enum, variant: chosen.variant };
}

/**
 * The nominal type of `declaration` that `expected` asks for, through any optionals wrapping it
 * (§2); `Optional<T>` itself when `declaration` is `Optional`.
 */
export function sameEnum(
  checker: Pick<CheckerContext, 'optionalEntity'>,
  expected: Type | undefined,
  declaration: EnumDeclaration,
): NominalType | undefined {
  for (
    let current = expected;
    current !== undefined;
    current = optionalInner(current, checker.optionalEntity)
  ) {
    if (current.kind === 'nominal' && current.entity.declaration === declaration) {
      return current;
    }
  }
  return undefined;
}

/** The struct without fields `entity` names, the one type a bare name makes a value of (§3.1). */
export function fieldlessStructOf(
  checker: Pick<CheckerContext, 'declaredFieldsOf'>,
  entity: Entity,
): StructDeclaration | undefined {
  if (
    entity.kind !== 'type' ||
    entity.declaration.kind !== 'StructDeclaration' ||
    entity.declaration.isShared
  ) {
    return undefined;
  }
  return checker.declaredFieldsOf(entity.declaration).length > 0 ? undefined : entity.declaration;
}
