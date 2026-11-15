/**
 * What a name in value position names, where the binder alone can't tell (§3.1, §3.10, §3.11): a
 * type, as a static function's owner or a conversion's target, and as what a pattern names
 * (pattern-types.ts reads it here); a variant, which a bare name picks by the enum expected, in a
 * pattern alike; or a struct without fields, the one type a bare name makes a value of. And what
 * static functions on a type are declared on (§3.7, §3.17). Its static functions
 * (constructs/declarations/functions/statics.ts, constructs/declarations/functions/clashes.ts,
 * resolution/choosing/candidates.ts) and the editor's completion read the same rules here, so what
 * a name may name and what it then means can't drift apart.
 *
 * - A name in a value's place gives no type arguments, so it names a generic type only as a whole,
 *   with its own parameters where they are written.
 * - Static functions are declared on a nominal type's declaration, a primitive, a shape or a
 *   recursive type (§3.17), whichever alias names it; a generic alias of a shape names the family
 *   its parameters make, keyed by them, so its static functions are reached through it.
 */

import type { PrimitiveName } from '../../../../foundation/language/primitives.ts';
import { staticName } from '../../../../foundation/language/static-names.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type {
  Entity,
  VariantEntity,
  VariantNaming,
  VariantsEntity,
} from '../../../binder/entities.ts';
import type { ModuleId } from '../../../program/program.ts';
import type {
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
  Variant,
} from '../../../syntax/declarations/index.ts';
import type { Expression, Index, MemberAccess } from '../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { Checker } from '../../check.ts';
import type { CheckedModule, CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { enumsExpected } from '../fitting/expected.ts';
import { type ShapeKey, typeKeys } from '../identity/type-keys.ts';
import {
  isNominalEntity,
  type NominalDeclaration,
  type NominalEntity,
  type Type,
} from '../type/index.ts';
import { expectsError } from '../type/primitives.ts';
import { optionalInner } from '../unions/unions.ts';
import { typeOfEntity } from './resolve-type.ts';

export type Aliases = Pick<Checker, 'aliasedType' | 'typeRules' | 'wellKnownEntity'>;

/** The entity a nominal type's declaration declares, which its types are made of. */
export function nominalEntityOf(
  checker: Pick<Checker, 'bindings' | 'moduleOf'>,
  declaration: NominalDeclaration,
): NominalEntity {
  const entity = checker.bindings.entityOf(checker.moduleOf(declaration), declaration.name);
  if (entity?.kind !== 'type' || !isNominalEntity(entity)) {
    unreachable(`'${declaration.name.text}' declares no nominal type.`);
  }
  return entity;
}

/**
 * The type `entity` names, a trait's none: a declared type or an alias with no type arguments
 * given, so a generic one stands as a whole, with its own parameters where they are written.
 */
export function entityType(checker: Aliases, entity: Entity | undefined): Type | undefined {
  return entity === undefined ? undefined : typeOfEntity(checker, entity, () => []);
}

/**
 * What `T?`'s static functions are declared on (§3.8, §3.17): every optional, whatever its `T`, as
 * an alias of `T | None` declares them, such as the prelude's `Optional`.
 */
const optionalOwner = 'T?';

/**
 * What static functions are declared on (§3.7, §3.17): a nominal type's declaration, a primitive's
 * name, a shape's or a recursive type's key, which no primitive's name is, or every optional.
 */
export type StaticOwner = NominalDeclaration | PrimitiveName | ShapeKey | typeof optionalOwner;

/** What static functions on `type` are declared on; undefined for a type that has none. */
export function staticOwnerOf(type: Type | undefined): StaticOwner | undefined {
  switch (type?.kind) {
    case 'primitive':
      return type.name;
    case 'nominal':
      return type.entity.declaration;
    case 'anonymous':
      return typeKeys.shapeKey(type);
    case 'recursive':
      return typeKeys.typeKey(type) as ShapeKey;
    case 'union':
      return optionalInner(type) === undefined ? undefined : optionalOwner;
    default:
      return undefined;
  }
}

/**
 * What the static function `declaration` of `module` is declared on: the type its owner names, an
 * alias the type it stands for; undefined for any other function, or an owner with none.
 */
export function declaredOwnerOf(
  checker: Pick<Checker, 'aliasedType' | 'typeRules' | 'bindings' | 'wellKnownEntity'>,
  module: ModuleId,
  declaration: FunctionDeclaration,
): StaticOwner | undefined {
  return declaration.owner === undefined
    ? undefined
    : staticOwnerOf(entityType(checker, checker.bindings.entityOf(module, declaration.owner)));
}

/**
 * What naming a type in value position reads: the checker, what the binder says a name is, and a
 * type as the pass being checked reads it, each loop's key over a type's keys bound (§4).
 */
interface Naming {
  readonly checker: CheckerContext;
  readonly entityOf: (name: Identifier) => Entity | undefined;
  readonly inPass: (type: Type) => Type;
}

/** Where a bare variant is chosen: the module's, which reports and records the variant chosen. */
interface VariantChoosing extends CheckedModule {
  readonly recordVariant: (name: Identifier, variant: VariantEntity) => void;
}

/**
 * The type a type named in value position denotes, as the owner of a static call or the target
 * of a conversion; undefined when `node` names no type.
 */
export function namedType(context: Naming, node: Expression): Type | undefined {
  if (node.kind === 'Index') {
    return indexedNamed(context, node);
  }
  const name = nameNodeOf(node);
  const entity = name === undefined ? undefined : context.entityOf(name);
  if (entity === undefined && node.kind === 'MemberAccess' && !node.isOptional) {
    return associatedNamed(context, node);
  }
  const type = entityType(context.checker, entity);
  return type === undefined ? undefined : context.inPass(type);
}

/**
 * The type of the field a type indexed by a key names, `S[K]` (§3.10): written before `.`, a type
 * indexed by a type names a type, never an index into a value, the error type for a key naming no
 * field of it; undefined for any other index.
 */
function indexedNamed(context: Naming, node: Index): Type | undefined {
  const owner = node.isOptional ? undefined : namedType(context, node.target);
  const key = owner === undefined ? undefined : namedType(context, node.index);
  return owner === undefined || key === undefined
    ? undefined
    : context.checker.typeRules.fieldType(owner, key);
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
  context: VariantChoosing,
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
      const qualified = qualifiedHere(context, naming);
      context.report(checkerDiagnostics.bareVariant(at.span, at.name.text, qualified));
    }
    return undefined;
  }
  context.recordVariant(at.name, chosen);
  return { enum: chosen.enum, variant: chosen.variant };
}

/**
 * How the module `context` checks can qualify a bare variant: through each enum having one of its
 * name that the module's top level names, so a message suggests only what it can write, whatever
 * other modules declare (`variantsQualifiableIn`).
 */
function qualifiedHere(context: CheckedModule, naming: VariantsEntity): readonly string[] {
  return context.checker.inputs
    .variantsQualifiableIn(context.module, naming.name)
    .map((candidate) => staticName(candidate.enum.name.text, candidate.variant.name.text));
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
