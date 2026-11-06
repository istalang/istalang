/**
 * What a name in value position names, where the binder alone can't tell (§3.1, §3.11): a type, as
 * the owner of a static call or a conversion's target; a variant, which a bare name picks by the
 * enum expected; or a struct without fields, the one type a bare name makes a value of. Patterns
 * name a variant the same way; the type a name names is types/named-types.ts's.
 */

import type { Entity, VariantNaming } from '../../binder/entities.ts';
import type { EnumDeclaration, StructDeclaration, Variant } from '../../syntax/declarations.ts';
import type { Expression, MemberAccess } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { BodyContext } from '../body-context.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { enumsExpected } from '../types/expected.ts';
import { entityType } from '../types/named-types.ts';
import { expectsError } from '../types/primitives.ts';
import type { Type } from '../types/type.ts';

/** What naming a type in value position reads: the checker, and what the binder says a name is. */
export type Naming = Pick<BodyContext, 'checker' | 'entityOf'>;

/**
 * The type a type named in value position denotes, as the owner of a static call or the target
 * of a conversion; undefined when `node` names no type.
 */
export function namedType(context: Naming, node: Expression): Type | undefined {
  const name = nameNodeOf(node);
  const entity = name === undefined ? undefined : context.entityOf(name);
  if (entity === undefined && node.kind === 'MemberAccess' && !node.isOptional) {
    return associatedNamed(context, node);
  }
  return entityType(context.checker, entity);
}

/**
 * The associated type `access` names, `R.Data` (§3.1): its member on the type its target names,
 * through which a static function is called (`R.Data.default()`); undefined for any other member.
 */
function associatedNamed(context: Naming, access: MemberAccess): Type | undefined {
  const owner = namedType(context, access.target);
  if (owner === undefined) {
    return undefined;
  }
  const associated = context.checker.typeRules.associatedType(owner, access.member.text);
  return associated.kind === 'error' ? undefined : associated;
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
 * expected enum has (§3.11), recorded for the bare name. A pattern names a variant the same way,
 * its value's type expected.
 */
export function chooseVariant(
  context: BodyContext,
  at: { readonly span: AnchoredSpan; readonly name: Identifier },
  naming: VariantNaming,
  expected: Type | undefined,
): { enum: EnumDeclaration; variant: Variant } | undefined {
  if (naming.kind === 'variant') {
    return { enum: naming.enum, variant: naming.variant };
  }
  const chosen = context.checker.inputs.variantNamed(naming.name, enumsExpected(expected));
  if (chosen === undefined) {
    if (!expectsError(expected)) {
      context.report(checkerDiagnostics.bareVariant(at.span, at.name.text));
    }
    return undefined;
  }
  context.recordVariant(at.name, chosen);
  return { enum: chosen.enum, variant: chosen.variant };
}

/** The struct without fields `entity` names, the one type a bare name makes a value of (§3.1). */
export function fieldlessStructOf(
  checker: Pick<CheckerContext, 'declaredFieldsOf'>,
  entity: Entity,
): StructDeclaration | undefined {
  if (entity.kind !== 'type' || entity.declaration.kind !== 'StructDeclaration') {
    return undefined;
  }
  return checker.declaredFieldsOf(entity.declaration).length > 0 ? undefined : entity.declaration;
}
