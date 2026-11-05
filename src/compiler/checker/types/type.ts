/**
 * The checker's model of types (§2): what every expression, variable and signature has.
 *
 * - Types are plain immutable values compared by structure, except nominal types, which compare by
 *   the identity of the binder's entity for their declaration (§3.1: two declarations are two
 *   types even with identical fields). Entities live as long as their tree, so a type stays valid
 *   across Program snapshots that keep the declaring module.
 * - A nominal type carries its type arguments; field and variant types are derived on demand by
 *   substituting them (the checker's `fieldsOf` and `variantsOf`), never stored per instantiation.
 * - An anonymous struct (§3.1) is its shape: its field names and their types, wherever and in
 *   whatever order it is written, so two with the same fields are one type. It carries its fields,
 *   since it has no declaration to derive them from, always in name order (`shapeType`), the one
 *   order every struct lays its fields out in (`inFieldOrder`). Where it was written (`origin`) is only its spelling, for tools to locate it:
 *   the value behind a shared struct (§3.18) is the shape of the shared struct's fields, written at
 *   its declaration.
 * - A literal type (§2) is the one value of a `String`, `Int` or `Bool` literal: `"draft"`, `-1`,
 *   `true`. Its base is derived from its value, never stored beside it.
 * - `A | B` (§2) is a value of one of its members, a set: unions.ts normalizes it, so no value sits
 *   in two members and no union holds another. Its members keep the order they were first written
 *   in, which only its text reads; identity sorts them (type-keys.ts). `T?` is `T | None`, `None`
 *   being the primitive whose one value is `none`.
 * - `error` stands for a type a diagnostic has already explained. It is compatible with everything,
 *   so one mistake is reported once instead of at every use that follows.
 * - `Never` (§2) is the type of expressions that don't produce a value, and fits wherever any type
 *   is expected.
 * - A type parameter is keyed by its declaration. A trait's `Self` is the trait's own implicit
 *   parameter, keyed by the trait declaration, so substituting the constrained type for it is the
 *   same operation as for any other parameter.
 * - `any A & B` (§3.10) is a value of any type meeting each of its constraints, a set: their order
 *   and the way they were written don't make two types. A constraint's arguments may name its
 *   trait's `Self` (`any Iterable<Int>` is `Iterable<Int, Self>`), which stands for each value's own
 *   type. The `any` type binds it, so substituting from outside never replaces it, and no type
 *   mentioning it is open.
 * - An alias names no type of its own (§3.17): a type written through one carries it only so its
 *   text can read as written (`Entries<Int>`), which messages and hovers show. An associated type
 *   on a known type is such an alias too (`Field<Int>.Data`, §3.1), whose spelling also keeps
 *   inference from looking through it (§3.5); on a type not known yet, it is a type of its own,
 *   opaque (`AssociatedOfType`). Exact relations and
 *   type keys look through it. Only substitution keeps it, substituting its arguments too, since
 *   that rewrites the alias's own parameters alike; any other change of a type leaves a type the
 *   alias didn't write, so widening, the one other, drops it.
 * - Identity and the exact relations live in identity.ts, through type keys (type-keys.ts); fitting
 *   with the implicit conversions needs to know which type is `Optional`, so it lives in fit.ts.
 */

import type { PrimitiveName } from '../../../language/primitives.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { TypeEntity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import type {
  DeclaredStruct,
  EnumDeclaration,
  ExternStructDeclaration,
  Field,
  TraitDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';
import type { StructLiteral } from '../../syntax/expressions/index.ts';
import type { StructType } from '../../syntax/types.ts';
import { inFieldOrder } from './field-order.ts';

/** The alias a type was written through, with the arguments it was given there (§3.17). */
interface DeclaredAliasUse {
  readonly kind: 'alias';
  readonly declaration: TypeAliasDeclaration;
  readonly arguments: readonly Type[];
}

/**
 * The associated type `name` of `of` a type was written as, `Field<T>.Data` (§3.1): the same type
 * as what it names, which inference never looks through (§3.5).
 */
interface AssociatedUse {
  readonly kind: 'associated';
  readonly of: Type;
  readonly name: string;
}

/** How a type was written where it isn't spelled as itself: through an alias or an associated type. */
export type AliasUse = DeclaredAliasUse | AssociatedUse;

/** What every type carries beside its kind: the alias it was written through, if any. */
interface WrittenThrough {
  readonly alias?: AliasUse | undefined;
}

export interface PrimitiveType extends WrittenThrough {
  readonly kind: 'primitive';
  readonly name: PrimitiveName;
}

/** The declarations a nominal type can come from. */
export type NominalDeclaration = DeclaredStruct | EnumDeclaration | ExternStructDeclaration;

/** The binder's entity for a declaration a nominal type comes from. */
export type NominalEntity = TypeEntity & { readonly declaration: NominalDeclaration };

/** A trait a type must meet, with its type arguments; `Self` stands for the type meeting it. */
export interface Constraint {
  readonly trait: TraitDeclaration;
  readonly arguments: readonly Type[];
}

/** `any A & B`: a value of any type meeting every constraint, a set (§3.10). */
export interface AnyType extends WrittenThrough {
  readonly kind: 'any';
  readonly constraints: readonly Constraint[];
}

/** A declared struct, shared or not, enum or extern type, with its type arguments. */
export interface NominalType extends WrittenThrough {
  readonly kind: 'nominal';
  readonly entity: NominalEntity;
  readonly arguments: readonly Type[];
}

/** Whether `entity` declares a nominal type: a struct, an enum or an extern type. */
export function isNominalEntity(entity: TypeEntity): entity is NominalEntity {
  const { kind } = entity.declaration;
  return (
    kind === 'StructDeclaration' ||
    kind === 'SharedStructDeclaration' ||
    kind === 'EnumDeclaration' ||
    kind === 'ExternStructDeclaration'
  );
}

/**
 * The nominal type `entity` declares, given `typeArguments`. The binder types an entity by any
 * type declaration, so this checks once what a caller narrowed by the declaration's kind.
 */
export function nominalType(entity: TypeEntity, typeArguments: readonly Type[]): NominalType {
  if (!isNominalEntity(entity)) {
    unreachable(`A ${entity.declaration.kind} declares no nominal type.`);
  }
  return { kind: 'nominal', entity, arguments: typeArguments };
}

export interface TupleType extends WrittenThrough {
  readonly kind: 'tuple';
  readonly elements: readonly Type[];
}

/**
 * A field of a struct type, nominal or anonymous: its name, its type, and where it is declared,
 * whose annotations it carries (§3.16); a field a `struct{…}` literal made up has no declaration.
 */
export interface FieldMember {
  readonly name: string;
  readonly type: Type;
  /** Where the field is declared, and its type there, before any substitution. */
  readonly declared?: { readonly node: Field; readonly module: ModuleId; readonly type: Type };
}

/**
 * A struct without a name, its shape (§3.1): introduced by a `{…}` type, by a `struct{…}` literal
 * with nothing to take a type from, by a shared struct as the value behind it (§3.18), or by a
 * struct as the shape its value converts into. Its fields are in name order; `origin` is where it
 * was written, which no relation reads.
 */
export interface AnonymousStructType extends WrittenThrough {
  readonly kind: 'anonymous';
  readonly origin: StructType | StructLiteral | DeclaredStruct;
  readonly fields: readonly FieldMember[];
}

/** The shape of `fields`, written at `origin`: its fields in name order (§3.1). */
export function shapeType(
  origin: AnonymousStructType['origin'],
  fields: readonly FieldMember[],
): AnonymousStructType {
  return { kind: 'anonymous', origin, fields: inFieldOrder(fields) };
}

/** A parameter of a function type: its type, and whether it takes a reference (§3.7). */
export interface ParameterSlot {
  readonly type: Type;
  readonly reference: boolean;
}

/**
 * A function type; a sendable one's values capture only sendable values (§3.14). Its parameters
 * may end in a pack (`fn(Int, ...A) -> R`, §3.5), which stands for the parameters a tuple
 * substituted for it flattens into (`withPack`), so a type with a pack is always generic.
 */
export interface FunctionType extends WrittenThrough {
  readonly kind: 'function';
  readonly isSendable: boolean;
  readonly isAsync: boolean;
  readonly parameters: readonly ParameterSlot[];
  readonly pack?: PackType | undefined;
  readonly result: Type;
}

/** A function type's pack: a pack type parameter, or the error type for one that failed. */
export type PackType = TypeParameterType | ErrorType;

/** What a type parameter is keyed by: its declaration, or a trait standing for its `Self`. */
export type ParameterKey = TypeParameter | TraitDeclaration;

/**
 * A type parameter, opaque inside the declaration that introduces it (§3.5). A mapped entry's binds
 * it within the type (§3.1), whose keys a substitution from outside changes, so its occurrences
 * carry the keys it ranges over (`within`), substituted with them, never read again from where
 * it is written. Its key holds them (type-keys.ts): what is known of one field of several keys
 * isn't what is known of one of fewer, and results kept by a type's key must tell them apart.
 */
export interface TypeParameterType extends WrittenThrough {
  readonly kind: 'parameter';
  readonly declaration: ParameterKey;
  readonly within?: Type | undefined;
}

export interface ErrorType extends WrittenThrough {
  readonly kind: 'error';
}

/** The value of a literal type: an `Int`'s, a `String`'s or a `Bool`'s. */
export type LiteralValue = bigint | string | boolean;

/** A literal type (§2): the one value of a `String`, `Int` or `Bool` literal. */
export interface LiteralType extends WrittenThrough {
  readonly kind: 'literal';
  readonly value: LiteralValue;
}

/** `A | B` (§2): a value of one of its members, two or more, normalized (unions.ts). */
export interface UnionType extends WrittenThrough {
  readonly kind: 'union';
  readonly members: readonly Type[];
}

/**
 * `T.Data` (§3.1): the associated type `name` of `of`, a type not known yet, a type parameter or
 * another such type. Opaque (§3.5): equal only to itself, it meets what its trait requires of it
 * (`type Data is C`). An instantiation that makes `of` known reduces it to that type's own
 * associated type (TypeRules), so lowering never meets one.
 */
interface AssociatedOfType extends WrittenThrough {
  readonly kind: 'associated';
  readonly of: Type;
  readonly name: string;
}

/**
 * `S["meta"]` (§3.5, §3.9): the type of the field `key` names in `of`, a struct type not known
 * yet, such as a type parameter with a struct constraint. Opaque until an instantiation makes `of`
 * known (TypeRules): equal only to itself, it meets what the constraint's entry for that field
 * requires. A known struct's is its field's type.
 */
interface FieldOfType extends WrittenThrough {
  readonly kind: 'field';
  readonly of: Type;
  readonly key: Type;
}

/**
 * The keys of `of`, a struct type not known yet, that its struct constraints don't name, less those
 * `without` names, in name order (§3.1, §3.5): opaque until `of` is known. `keyof S` is this beside
 * the literals its constraints name, so a written key fits it as a union member does; the keys of
 * a field loop's other fields, a rest's and a mapped entry's are this with more names left out.
 */
interface KeysType extends WrittenThrough {
  readonly kind: 'keys';
  readonly of: Type;
  readonly without: readonly string[];
}

/**
 * A mapped struct type (§3.1) whose `keys` aren't all known yet: its `named` fields, in name
 * order, and a field of the type `value` for each key, `parameter` standing for that key in it.
 * Once the keys are String literals it is the shape of those fields (TypeRules), written at
 * `origin`; until then it is opaque, equal to another only up to the name of its parameter.
 */
interface MappedType extends WrittenThrough {
  readonly kind: 'mapped';
  readonly origin: StructType;
  readonly named: readonly FieldMember[];
  readonly parameter: TypeParameter;
  readonly keys: Type;
  readonly value: Type;
}

/** What a mapped struct type is built from (`MappedType`), reduced or not. */
export type MappedParts = Omit<MappedType, 'kind' | 'alias'>;

/** A type computed from others, opaque until they are known (§3.5): reduced by TypeRules. */
export type ComputedType = AssociatedOfType | FieldOfType | KeysType | MappedType;

/** Whether `type` is computed from types not known yet, so only an instantiation reduces it. */
export function isComputed(type: Type): type is ComputedType {
  return (
    type.kind === 'associated' ||
    type.kind === 'field' ||
    type.kind === 'keys' ||
    type.kind === 'mapped'
  );
}

/** Whether `type` is known only per instantiation: a type parameter, or computed from one (§3.5). */
export function isOpaque(type: Type): type is TypeParameterType | ComputedType {
  return type.kind === 'parameter' || isComputed(type);
}

/** A type a struct value can have: a declared struct or an anonymous one. */
export type StructValueType = NominalType | AnonymousStructType;

export type Type =
  | PrimitiveType
  | NominalType
  | AnonymousStructType
  | TupleType
  | FunctionType
  | TypeParameterType
  | AnyType
  | LiteralType
  | UnionType
  | AssociatedOfType
  | FieldOfType
  | KeysType
  | MappedType
  | ErrorType;

/** `type` as written through `alias`; the error type stays itself, as a diagnostic explained it. */
export function aliasedAs<Aliased extends Type>(type: Aliased, alias: AliasUse): Aliased {
  return type.kind === 'error' ? type : { ...type, alias };
}

/** The primitive type named `name`. */
export function primitiveType(name: PrimitiveName): PrimitiveType {
  return { kind: 'primitive', name };
}

export const intType = primitiveType('Int');
export const floatType = primitiveType('Float');
export const boolType = primitiveType('Bool');
export const stringType = primitiveType('String');
export const unitType = primitiveType('Unit');
export const neverType = primitiveType('Never');
export const noneType = primitiveType('None');
export const errorType: ErrorType = { kind: 'error' };

/**
 * Whether a value is expected to be of the error type, whose cause was reported already: a value
 * that needs an expected type to mean anything (`none`, a bare variant or generic struct without
 * fields, an empty collection, a function named among overloads, a lambda's untyped parameter)
 * reports nothing more.
 */
export function expectsError(expected: Type | undefined): boolean {
  return expected?.kind === 'error';
}

export function isPrimitive(type: Type, name: PrimitiveName): boolean {
  return type.kind === 'primitive' && type.name === name;
}

/** The tuple of `elements`: `Unit` for none, the empty tuple (§3.15). */
export function tupleType(elements: readonly Type[]): Type {
  return elements.length === 0 ? unitType : { kind: 'tuple', elements };
}

/** The elements of a tuple type, none of `Unit`; undefined for any other type. */
export function tupleElements(type: Type): readonly Type[] | undefined {
  if (type.kind === 'tuple') {
    return type.elements;
  }
  return isPrimitive(type, 'Unit') ? [] : undefined;
}
