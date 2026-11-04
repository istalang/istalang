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
 *   order a shape has. Where it was written (`origin`) is only its spelling, for tools to locate it:
 *   the value behind a shared struct (§3.18) is the shape of the shared struct's fields, written at
 *   its declaration.
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
 *   text can read as written (`Entries<Int>`), which messages and hovers show. Exact relations and
 *   type keys look through it. Only substitution keeps it, substituting its arguments too, since
 *   that rewrites the alias's own parameters alike; any other change of a type leaves a type the
 *   alias didn't write, so widening, the one other, drops it.
 * - Identity and the exact relations live in identity.ts, through type keys (type-keys.ts); fitting
 *   with the implicit conversions needs to know which type is `Optional`, so it lives in fit.ts.
 */

import { compareOrdered } from '../../../language/order.ts';
import type { PrimitiveName } from '../../../language/primitives.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { TypeEntity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import type {
  DeclaredStruct,
  EnumDeclaration,
  ExternStructDeclaration,
  Field,
  SharedStructDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';
import type { StructLiteral } from '../../syntax/expressions/index.ts';
import type { StructType } from '../../syntax/types.ts';

/** The alias a type was written through, with the arguments it was given there (§3.17). */
export interface AliasUse {
  readonly declaration: TypeAliasDeclaration;
  readonly arguments: readonly Type[];
}

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

interface TupleType extends WrittenThrough {
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
 * with nothing to take a type from, or by a shared struct as the value behind it (§3.18). Its
 * fields are in name order; `origin` is where it was written, which no relation reads.
 */
export interface AnonymousStructType extends WrittenThrough {
  readonly kind: 'anonymous';
  readonly origin: StructType | StructLiteral | SharedStructDeclaration;
  readonly fields: readonly FieldMember[];
}

/** Fields in name order, as JSON orders keys (§3.1, §9): the one order a shape keeps them in. */
export function byFieldName(first: { readonly name: string }, second: { readonly name: string }) {
  return compareOrdered(first.name, second.name);
}

/** The shape of `fields`, written at `origin`: its fields in name order (§3.1). */
export function shapeType(
  origin: AnonymousStructType['origin'],
  fields: readonly FieldMember[],
): AnonymousStructType {
  return { kind: 'anonymous', origin, fields: [...fields].sort(byFieldName) };
}

/** A parameter of a function type: its type, and whether it takes a reference (§3.7). */
export interface ParameterSlot {
  readonly type: Type;
  readonly reference: boolean;
}

/** A rest parameter: an array's (§3.3), whose arguments are its `item`s, or a pack's (§3.5). */
export type RestSlot = { readonly kind: 'array'; readonly item: Type } | { readonly kind: 'pack' };

/** The rest slot of a parameter or function type ending in a pack (§3.5). */
export const packRestSlot: RestSlot = { kind: 'pack' };

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

/** A type parameter, opaque inside the declaration that introduces it (§3.5). */
export interface TypeParameterType extends WrittenThrough {
  readonly kind: 'parameter';
  readonly declaration: ParameterKey;
}

export interface ErrorType extends WrittenThrough {
  readonly kind: 'error';
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

/** Whether `type` is a pack, a type parameter standing for a tuple of types (§3.5). */
export function isPack(type: Type): type is TypeParameterType {
  return (
    type.kind === 'parameter' &&
    type.declaration.kind === 'TypeParameter' &&
    type.declaration.isPack
  );
}

/** Whether `type` can stand for a pack: a tuple, `Unit` (the empty tuple), or a pack (§3.5). */
export function fillsPack(type: Type): boolean {
  return type.kind === 'error' || isPack(type) || tupleElements(type) !== undefined;
}

/**
 * `type` ending in `pack`: a pack it keeps, a tuple it flattens into parameters by value, `Unit`
 * into none (§3.5); anything else was refused where it was bound to a pack, so it leaves the error
 * type.
 */
export function withPack(type: FunctionType, pack: Type | undefined): FunctionType {
  if (pack === undefined) {
    return { ...type, pack: undefined };
  }
  if (isPack(pack) || pack.kind === 'error') {
    return { ...type, pack };
  }
  const elements = tupleElements(pack);
  if (elements === undefined) {
    return { ...type, pack: errorType };
  }
  const flattened = elements.map((element) => ({ type: element, reference: false }));
  return { ...type, parameters: [...type.parameters, ...flattened], pack: undefined };
}

/**
 * Whether two function types take the same parameters, each by value or by `&` alike, and give the
 * same result, their types compared by `parts`: exactly (`sameType`), or as inference matches a
 * declared type against a given one. Whether each is sendable or async is the caller's to compare.
 * A declared pack takes the given type's parameters past the declared ones, as their tuple, or the
 * given type's own pack when none are left (§3.5).
 */
export function sameShape(
  declared: FunctionType,
  given: FunctionType,
  parts: (declared: Type, given: Type) => boolean,
  results: (declared: Type, given: Type) => boolean = parts,
): boolean {
  const fixed = declared.parameters.length;
  const samePrefix =
    given.parameters.length >= fixed &&
    declared.parameters.every((parameter, index) => {
      const other = given.parameters[index];
      return (
        other !== undefined &&
        parameter.reference === other.reference &&
        parts(parameter.type, other.type)
      );
    });
  if (!samePrefix) {
    return false;
  }
  if (declared.pack === undefined) {
    return (
      given.parameters.length === fixed &&
      given.pack === undefined &&
      results(declared.result, given.result)
    );
  }
  const rest = restOf(given, fixed);
  return rest !== undefined && parts(declared.pack, rest) && results(declared.result, given.result);
}

/**
 * `type`'s parameters from `start` on as one pack: its own pack when none are left, otherwise the
 * tuple of those, `Unit` of none; undefined when they can't be one, since one takes a `&`.
 */
function restOf(type: FunctionType, start: number): Type | undefined {
  const rest = type.parameters.slice(start);
  if (type.pack !== undefined) {
    return rest.length === 0 ? type.pack : undefined;
  }
  return rest.some((slot) => slot.reference) ? undefined : tupleType(rest.map((slot) => slot.type));
}

/**
 * Whether a function of type `given` fits where `declared` is expected: async alike, sendable
 * where `declared` is (§3.14), and of the same shape (`sameShape`), its parts and results compared
 * as the caller says.
 */
export function functionFits(
  declared: FunctionType,
  given: FunctionType,
  parts: (declared: Type, given: Type) => boolean,
  results: (declared: Type, given: Type) => boolean = parts,
): boolean {
  return (
    given.isAsync === declared.isAsync &&
    (given.isSendable || !declared.isSendable) &&
    sameShape(declared, given, parts, results)
  );
}
