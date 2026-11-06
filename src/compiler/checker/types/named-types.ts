/**
 * The type a name names where a type is written in a value's place: as a static function's owner
 * or a conversion's target (§3.10), and as what a pattern names (pattern-types.ts reads it here);
 * and what static functions on a type are declared on (§3.7, §3.17). Its static functions
 * (declarations/statics.ts, declarations/functions/clashes.ts, resolution/candidates.ts) and the
 * editor's completion read the same rules here, so what a name may name and what it then means
 * can't drift apart.
 *
 * - A name in a value's place gives no type arguments, so it names a generic type only as a whole,
 *   with its own parameters where they are written.
 * - Static functions are declared on a nominal type's declaration, a primitive, a shape or a
 *   recursive type (§3.17), whichever alias names it; a generic alias of a shape names the family
 *   its parameters make, keyed by them, so its static functions are reached through it.
 */

import type { PrimitiveName } from '../../../language/primitives.ts';
import type { Entity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Checker } from '../check.ts';
import { typeOfEntity } from './resolve-type.ts';
import type { NominalDeclaration, Type } from './type.ts';
import { type ShapeKey, typeKeys } from './type-keys.ts';
import { optionalInner } from './unions.ts';

export type Aliases = Pick<Checker, 'aliasedType' | 'typeRules'>;

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
  checker: Pick<Checker, 'aliasedType' | 'typeRules' | 'bindings'>,
  module: ModuleId,
  declaration: FunctionDeclaration,
): StaticOwner | undefined {
  return declaration.owner === undefined
    ? undefined
    : staticOwnerOf(entityType(checker, checker.bindings.entityOf(module, declaration.owner)));
}
