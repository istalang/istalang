/**
 * The type a name names where a type is written in a value's place: as a static function's owner
 * or a conversion's target (§3.10), and in a pattern (§3.11); and what static functions on a type
 * are declared on (§3.7, §3.17). The checker's patterns (patterns/matching.ts,
 * patterns/downcasts.ts), its static functions (declarations/statics.ts, rules/clashes.ts,
 * resolution/candidates.ts) and the editor's completion read the same rules here, so what a name
 * may name and what it then means can't drift apart.
 *
 * - A name in a value's place gives no type arguments, so it names a generic type only as a whole:
 *   against a value of that type it matches every instance, but against an `any` value, whose own
 *   type is one instance, it names none. A generic alias stands for no one type, so it names none
 *   either.
 * - An alias names the type it stands for; a trait, a type parameter, `Self` and `Never`, which no
 *   value has, name no type a value is tested for.
 * - Static functions are declared on a nominal type's declaration, a primitive, or a shape (§3.17),
 *   whichever alias names it; a generic alias of a shape names the family its parameters make,
 *   keyed by them, so its static functions are reached through it.
 * - An `any` type holds a type whose values convert into it (types/fit.ts), the conversion's own
 *   rule, so what a pattern may name there and what may be converted in agree.
 * - Against an `any` value, a variant qualified by its enum names the enum, whose value is then
 *   tested for the variant; a bare variant name is chosen by the expected enum, so it names none.
 * - Against a union's value, a pattern selects members (§3.11, patterns/members.ts): a name the
 *   members it names (`membersNamed`), a generic type's instances or the one its type arguments
 *   give (`instancesWith`), a literal its own member or its base's (`literalMembers`), and a
 *   tuple, array or `struct{…}` pattern the members of its kind (`kindMembers`).
 */

import type { PrimitiveName } from '../../../language/primitives.ts';
import { sameItems } from '../../../structures/equality.ts';
import { type Entity, typeEntity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration, TypeAliasDeclaration } from '../../syntax/declarations.ts';
import type { Checker } from '../check.ts';
import { sameType } from './identity.ts';
import { typeOfEntity } from './resolve-type.ts';
import {
  type AnyType,
  isPrimitive,
  type NominalDeclaration,
  recursionOf,
  type Type,
  tupleElements,
} from './type.ts';
import { type ShapeKey, typeKeys } from './type-keys.ts';
import { type TypeRules, unfolded } from './type-rules.ts';
import { absorbingMember, baseOf, hasMember, holdingMember, optionalInner } from './unions.ts';
import { arrayElement } from './well-known.ts';

type Aliases = Pick<Checker, 'aliasedType' | 'typeRules'>;

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
 * name, a shape's or a recursive alias use's key, which no primitive's name is, or every optional.
 */
export type StaticOwner = NominalDeclaration | PrimitiveName | ShapeKey | typeof optionalOwner;

/** What static functions on `type` are declared on; undefined for a type that has none. */
export function staticOwnerOf(type: Type | undefined): StaticOwner | undefined {
  const use = type === undefined ? undefined : recursionOf(type);
  if (use !== undefined) {
    return typeKeys.recursionKey(use);
  }
  switch (type?.kind) {
    case 'primitive':
      return type.name;
    case 'nominal':
      return type.entity.declaration;
    case 'anonymous':
      return typeKeys.shapeKey(type);
    case 'recursive':
      return typeKeys.recursionKey(type);
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

/** A generic type a pattern names: a nominal one, or a recursive alias, whose uses are types (§3.17). */
export type GenericDeclaration = NominalDeclaration | TypeAliasDeclaration;

/** The type a pattern naming an entity tests a value for. */
export type PatternType =
  | { readonly kind: 'type'; readonly type: Type }
  /**
   * A generic type, named without the type arguments a pattern can't give: a nominal type, or a
   * recursive alias, each of whose uses is a type of its own (§3.17).
   */
  | { readonly kind: 'generic'; readonly declaration: GenericDeclaration }
  /** A generic alias of no recursion, which stands for no one type without its type arguments. */
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
    declaration.kind !== 'AssociatedType' &&
    declaration.kind !== 'RequiredAssociatedType' &&
    declaration.typeParameters.length > 0;
  if (isGeneric) {
    return declaration.kind === 'TypeAliasDeclaration' &&
      checker.aliasedType(declaration).kind !== 'recursive'
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
  checker: Pick<Checker, 'aliasedType' | 'typeRules' | 'fitOf'>,
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
      return instanceOf(type, named.declaration) !== undefined;
    case 'genericAlias':
    case 'none':
      return false;
    default: {
      const unhandled: never = named;
      return unhandled;
    }
  }
}

/** What a pattern naming a type selects of a union's members reads of the program. */
type MemberNaming = Pick<Checker, 'aliasedType' | 'typeRules' | 'variantsOf'>;

/**
 * The members of a union a pattern naming `entity` selects (§3.11): the enums declaring a variant
 * it names, bare or qualified; the member of a type it names, else the members of a union it names
 * where the union holds them all (`case Status as s` against `Status | Int`), else every literal
 * member of that base (`case String as s` against `Status | Int`), else the type itself where an
 * `any` or a recursive member took it whole (`case Int` against `Plain | any Shows`, or against
 * `Tree | String`), a downcast through that member; every member instantiating a generic type it
 * names. Anything else, a constant's name among them, selects none here.
 */
export function membersNamed(
  checker: MemberNaming,
  entity: Entity,
  members: readonly Type[],
): readonly Type[] {
  switch (entity.kind) {
    case 'variants':
      return variantOwners(checker, members, entity.name);
    case 'variant':
      return members.filter(
        (member) => member.kind === 'nominal' && member.entity.declaration === entity.enum,
      );
    default:
      return typeMembers(checker, entity, members);
  }
}

/** The enum members declaring a variant named `name`. */
export function variantOwners(
  checker: Pick<Checker, 'variantsOf'>,
  members: readonly Type[],
  name: string,
): readonly Type[] {
  return members.filter(
    (member) =>
      member.kind === 'nominal' &&
      (checker.variantsOf(member) ?? []).some((variant) => variant.name === name),
  );
}

function typeMembers(checker: Aliases, entity: Entity, members: readonly Type[]): readonly Type[] {
  const named = patternTypeOf(checker, entity);
  switch (named.kind) {
    case 'type': {
      const own = members.filter((member) => sameType(member, named.type));
      if (own.length > 0) {
        return own;
      }
      const inside = members.filter((member) => hasMember(named.type, member));
      if (named.type.kind === 'union' && inside.length === named.type.members.length) {
        return inside;
      }
      const literals = members.filter(
        (member) => member.kind === 'literal' && sameType(baseOf(member), named.type),
      );
      if (literals.length > 0) {
        return literals;
      }
      return takenWhole(members, named.type, checker.typeRules) ? [named.type] : [];
    }
    case 'generic':
      return members.filter((member) => instanceOf(member, named.declaration) !== undefined);
    default:
      return [];
  }
}

/**
 * Of the generic type `declaration`'s instances among `members`, the one instantiating it with
 * `typeArguments`.
 */
export function instancesWith(
  members: readonly Type[],
  declaration: GenericDeclaration,
  typeArguments: readonly Type[],
): readonly Type[] {
  return members.filter((member) => {
    const instance = instanceOf(member, declaration);
    return instance !== undefined && sameItems(sameType)(instance, typeArguments);
  });
}

/**
 * The type arguments `type` instantiates the generic `declaration` with: a nominal type's, or a
 * recursive alias use's, whether used or unfolded (§3.17), which a nominal type it unfolds to is an
 * instance of as well; undefined when it instantiates `declaration` in neither way.
 */
function instanceOf(type: Type, declaration: GenericDeclaration): readonly Type[] | undefined {
  const use = type.kind === 'recursive' ? type : recursionOf(type);
  if (use?.declaration === declaration) {
    return use.arguments;
  }
  return type.kind === 'nominal' && type.entity.declaration === declaration
    ? type.arguments
    : undefined;
}

/**
 * The members a literal of type `literal` selects: its own literal type's, else its base's, else
 * the literal itself through the `any` or recursive member that took it whole (§2), as `rules`
 * say: the value inside that member is the literal's own.
 */
export function literalMembers(
  members: readonly Type[],
  literal: Type,
  rules: TypeRules,
): readonly Type[] {
  const own = members.find((member) => sameType(member, literal));
  if (own !== undefined) {
    return [own];
  }
  const base = baseOf(literal);
  const based = members.filter((member) => sameType(member, base));
  return based.length === 0 && takenWhole(members, literal, rules) ? [literal] : based;
}

/**
 * Whether an `any` or a recursive member among `members` took `type` whole (§2, §3.17), so a value
 * of it sits inside that member's.
 */
function takenWhole(members: readonly Type[], type: Type, rules: TypeRules): boolean {
  return (
    absorbingMember(members, type, rules) !== undefined ||
    holdingMember(members, type, rules) !== undefined
  );
}

/**
 * What a pattern of a kind holding no name selects: a tuple pattern of `count` elements the tuple
 * members of that many, an array pattern the `Array` members, a `struct{…}` pattern the shape
 * members having each of its `fields`.
 */
export type PatternKind =
  | { readonly kind: 'tuple'; readonly count: number }
  | { readonly kind: 'array' }
  | { readonly kind: 'shape'; readonly fields: readonly string[] };

/**
 * The members a pattern of `pattern`'s kind selects, as `PatternKind` says, each read as what it
 * unfolds to where it is a recursive alias use (§3.17).
 */
export function kindMembers(
  checker: Pick<Checker, 'wellKnownType' | 'typeRules'>,
  pattern: PatternKind,
  members: readonly Type[],
): readonly Type[] {
  return members.filter((member) =>
    isOfKind(checker, pattern, unfolded(member, checker.typeRules)),
  );
}

function isOfKind(
  checker: Pick<Checker, 'wellKnownType'>,
  pattern: PatternKind,
  member: Type,
): boolean {
  switch (pattern.kind) {
    case 'tuple':
      return tupleElements(member)?.length === pattern.count;
    case 'array':
      return arrayElement(checker, member) !== undefined;
    default:
      return (
        member.kind === 'anonymous' &&
        pattern.fields.every((name) => member.fields.some((field) => field.name === name))
      );
  }
}
