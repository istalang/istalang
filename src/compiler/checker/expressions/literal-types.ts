/**
 * What a literal naming a type builds (§3.1, §3.17): a declared struct, with the type arguments
 * written or expected; or, through an alias of a shape, the shape, the alias's own type parameters
 * inferred from the values as a generic struct's are, so a generic alias names a family of shapes
 * a literal picks one of (structs.ts checks the literal). An alias names a struct declaration only
 * as a type: its literal names the struct itself.
 */

import type { Entity } from '../../binder/entities.ts';
import { type DeclaredStruct, isDeclaredStruct } from '../../syntax/declarations.ts';
import type { FieldsLiteral } from '../../syntax/expressions/index.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { BodyContext } from '../context.ts';
import { substitute, substitutionFor } from '../types/substitution.ts';
import { aliasedAs, isNominalEntity, type NominalEntity, type Type } from '../types/type.ts';
import { knownArguments, type LiteralShape } from './literal-fields.ts';

/** What a literal naming a type builds: a declared struct, or a shape an alias names. */
export type Built =
  | {
      readonly kind: 'declared';
      readonly entity: NominalEntity;
      readonly struct: DeclaredStruct;
      readonly known: readonly Type[] | undefined;
    }
  | { readonly kind: 'shape'; readonly shape: LiteralShape };

/**
 * What a literal naming `entity` builds: a declared struct, with the type arguments written or
 * expected, or the shape an alias names; undefined for anything else.
 */
export function builtThrough(
  context: BodyContext,
  node: FieldsLiteral & { readonly type: NamedType },
  entity: Entity,
  expected: Type | undefined,
): Built | undefined {
  if (entity.kind !== 'type') {
    return undefined;
  }
  const { declaration } = entity;
  if (isNominalEntity(entity) && isDeclaredStruct(declaration)) {
    const known = knownArguments(context, node.type, declaration, expected);
    return { kind: 'declared', entity, struct: declaration, known };
  }
  if (declaration.kind !== 'TypeAliasDeclaration') {
    return undefined;
  }
  const aliased = context.checker.aliasedType(declaration);
  const known = knownArguments(context, node.type, declaration, expected);
  const typeOf = (typeArguments: readonly Type[]): Type =>
    aliasedAs(substitute(aliased, substitutionFor(declaration.typeParameters, typeArguments)), {
      declaration,
      arguments: typeArguments,
    });
  return aliased.kind === 'anonymous'
    ? { kind: 'shape', shape: { owner: declaration, known, fields: aliased.fields, typeOf } }
    : undefined;
}
