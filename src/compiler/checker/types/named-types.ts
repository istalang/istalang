/**
 * The type a name names where a type is written in a value's place: as a static function's owner
 * or a conversion's target (§3.10), and in a pattern (§3.11). The checker's patterns
 * (patterns/matching.ts, patterns/downcasts.ts) and the editor's (completion) read the same rules
 * here, so what a pattern may name and what it then matches can't drift apart.
 *
 * - A pattern gives no type arguments, so it names a generic type only as a whole: against a value
 *   of that type it matches every instance, but against an `any` value, whose own type is one
 *   instance, it names none. A generic alias stands for no one type, so it names none either.
 * - An alias names the type it stands for; a trait, a type parameter, `Self` and `Never`, which no
 *   value has, name no type a value is tested for.
 * - An `any` type holds a type whose values convert into it (types/fit.ts), the conversion's own
 *   rule, so what a pattern may name there and what may be converted in agree.
 * - Against an `any` value, a variant qualified by its enum names the enum, whose value is then
 *   tested for the variant; a bare variant name is chosen by the expected enum, so it names none.
 */

import { type Entity, typeEntity } from '../../binder/entities.ts';
import type { TypeAliasDeclaration } from '../../syntax/declarations.ts';
import type { Checker } from '../check.ts';
import { parameterType } from './resolve-type.ts';
import {
  type AnyType,
  aliasedAs,
  isPrimitive,
  type NominalDeclaration,
  nominalType,
  primitiveType,
  sameType,
  type Type,
} from './type.ts';

type Aliases = Pick<Checker, 'aliasedType'>;

/** The type `entity` names, a trait's none: a declared type with no type arguments given. */
export function entityType(checker: Aliases, entity: Entity | undefined): Type | undefined {
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
      return aliasedAs(checker.aliasedType(declaration), { declaration, arguments: [] });
    case 'TraitDeclaration':
      return undefined;
    default:
      return nominalType(entity, []);
  }
}

/** The type a pattern naming an entity tests a value for. */
export type PatternType =
  | { readonly kind: 'type'; readonly type: Type }
  /** A generic type, named without the type arguments a pattern can't give. */
  | { readonly kind: 'generic'; readonly declaration: NominalDeclaration }
  /** A generic alias, which stands for no one type without its type arguments. */
  | { readonly kind: 'genericAlias'; readonly declaration: TypeAliasDeclaration }
  | { readonly kind: 'none' };

const namesNone: PatternType = { kind: 'none' };

/**
 * The type a pattern naming `entity` names: the one `entityType` gives, but a type parameter's or
 * `Never`, which no value has, however it is named.
 */
export function patternTypeOf(checker: Aliases, entity: Entity): PatternType {
  const declaration = entity.kind === 'type' ? entity.declaration : undefined;
  const isGeneric =
    declaration !== undefined &&
    declaration.kind !== 'TypeParameter' &&
    declaration.kind !== 'TraitDeclaration' &&
    declaration.typeParameters.length > 0;
  if (isGeneric) {
    return declaration.kind === 'TypeAliasDeclaration'
      ? { kind: 'genericAlias', declaration }
      : { kind: 'generic', declaration };
  }
  const type = entityType(checker, entity);
  return type === undefined || type.kind === 'parameter' || isPrimitive(type, 'Never')
    ? namesNone
    : { kind: 'type', type };
}

/** What a pattern naming a type tests an `any` value for: a type it may hold, or one it can't. */
export type DowncastTarget = PatternType | { readonly kind: 'unheld'; readonly type: Type };

/**
 * What a pattern naming `entity` tests a value of the `any` type `from` for (§3.10). The value
 * inside has its own type, never an `any` one, so an alias of an `any` type names none.
 */
export function downcastTargetOf(
  checker: Pick<Checker, 'aliasedType' | 'fitOf'>,
  entity: Entity,
  from: AnyType,
): DowncastTarget {
  const named = patternTypeOf(
    checker,
    entity.kind === 'variant' ? typeEntity(entity.enum) : entity,
  );
  if (named.kind !== 'type' || named.type.kind === 'error') {
    return named;
  }
  if (named.type.kind === 'any') {
    return namesNone;
  }
  return checker.fitOf(named.type, from)?.conversion.kind === 'any'
    ? named
    : { kind: 'unheld', type: named.type };
}

/**
 * Whether a pattern naming `entity` matches every value of `type`: it names that very type, a
 * generic one with any type arguments. An alias left in error matches, as it was reported where it
 * was declared.
 */
export function namesOwnType(checker: Aliases, entity: Entity, type: Type): boolean {
  const named = patternTypeOf(checker, entity);
  switch (named.kind) {
    case 'type':
      return named.type.kind === 'error' || sameType(named.type, type);
    case 'generic':
      return type.kind === 'nominal' && type.entity.declaration === named.declaration;
    case 'genericAlias':
    case 'none':
      return false;
    default: {
      const unhandled: never = named;
      return unhandled;
    }
  }
}
