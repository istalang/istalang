/**
 * The checker's model of types (§2): what every expression, variable and signature has.
 *
 * - Types are plain immutable values compared by structure, except nominal types, which compare by
 *   the identity of the binder's entity for their declaration (§3.1: two declarations are two
 *   types even with identical fields). Entities live as long as their tree, so a type stays valid
 *   across Program snapshots that keep the declaring module.
 * - A nominal type carries its type arguments; field and variant types are derived on demand by
 *   substituting them (the checker's `fieldsOf` and `variantsOf`), never stored per instantiation.
 * - An anonymous struct (§3.1) is a type of its own wherever one is written: two are never the
 *   same type, even with identical fields, so its identity is the node that introduced it. It
 *   carries its fields, since it has no declaration to derive them from; instantiating a generic
 *   declaration substitutes them, so identity is the origin plus the fields' types.
 * - `error` stands for a type a diagnostic has already explained. It is compatible with everything,
 *   so one mistake is reported once instead of at every use that follows.
 * - `never` (§2) is the type of expressions that don't produce a value, and fits wherever any type
 *   is expected.
 * - A type parameter is keyed by its declaration. A trait's `Self` is the trait's own implicit
 *   parameter, keyed by the trait declaration, so substituting the constrained type for it is the
 *   same operation as for any other parameter.
 * - Exact relations live here; fitting with the implicit wrap into `T?` needs to know which type
 *   is `Optional`, so it lives in fit.ts.
 */

import type { PrimitiveName } from '../../../language/primitives.ts';
import type { TypeEntity } from '../../binder/entities.ts';
import type {
  EnumDeclaration,
  ExternStructDeclaration,
  StructDeclaration,
  TraitDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';
import type { StructLiteral } from '../../syntax/expressions.ts';
import type { StructType } from '../../syntax/types.ts';

export interface PrimitiveType {
  readonly kind: 'primitive';
  readonly name: PrimitiveName;
}

/** The declarations a nominal type can come from. */
export type NominalDeclaration = StructDeclaration | EnumDeclaration | ExternStructDeclaration;

/** The binder's entity for a declaration a nominal type comes from. */
export type NominalEntity = TypeEntity & { readonly declaration: NominalDeclaration };

/** A declared struct, enum or extern type, with its type arguments. */
export interface NominalType {
  readonly kind: 'nominal';
  readonly entity: NominalEntity;
  readonly arguments: readonly Type[];
}

/** Whether `entity` declares a nominal type: a struct, an enum or an extern type. */
export function isNominalEntity(entity: TypeEntity): entity is NominalEntity {
  const { kind } = entity.declaration;
  return (
    kind === 'StructDeclaration' || kind === 'EnumDeclaration' || kind === 'ExternStructDeclaration'
  );
}

/**
 * The nominal type `entity` declares, given `typeArguments`. The binder types an entity by any
 * type declaration, so this checks once what a caller narrowed by the declaration's kind.
 */
export function nominalType(entity: TypeEntity, typeArguments: readonly Type[]): NominalType {
  if (!isNominalEntity(entity)) {
    throw new Error(`A ${entity.declaration.kind} declares no nominal type.`);
  }
  return { kind: 'nominal', entity, arguments: typeArguments };
}

export interface TupleType {
  readonly kind: 'tuple';
  readonly elements: readonly Type[];
}

/** A field of a struct type, nominal or anonymous: its name and its type. */
export interface FieldMember {
  readonly name: string;
  readonly type: Type;
}

/**
 * A struct without a name (§3.1): introduced by a `{…}` type, or by a `struct{…}` literal with
 * nothing to take a type from.
 */
export interface AnonymousStructType {
  readonly kind: 'anonymous';
  readonly origin: StructType | StructLiteral;
  readonly fields: readonly FieldMember[];
}

/** A parameter of a function type: its type, and whether it takes a reference (§3.7). */
export interface ParameterSlot {
  readonly type: Type;
  readonly reference: boolean;
}

export interface FunctionType {
  readonly kind: 'function';
  readonly isAsync: boolean;
  readonly parameters: readonly ParameterSlot[];
  readonly result: Type;
}

/** What a type parameter is keyed by: its declaration, or a trait standing for its `Self`. */
export type ParameterKey = TypeParameter | TraitDeclaration;

/** A type parameter, opaque inside the declaration that introduces it (§3.5). */
export interface TypeParameterType {
  readonly kind: 'parameter';
  readonly declaration: ParameterKey;
}

export interface ErrorType {
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
  | ErrorType;

/** The primitive type named `name`. */
export function primitiveType(name: PrimitiveName): PrimitiveType {
  return { kind: 'primitive', name };
}

export const intType = primitiveType('int');
export const floatType = primitiveType('float');
export const boolType = primitiveType('bool');
export const stringType = primitiveType('string');
export const unitType = primitiveType('unit');
export const neverType = primitiveType('never');
export const errorType: ErrorType = { kind: 'error' };

export function isPrimitive(type: Type, name: PrimitiveName): boolean {
  return type.kind === 'primitive' && type.name === name;
}

/** Whether two types are the same type. */
export function sameType(first: Type, second: Type): boolean {
  switch (first.kind) {
    case 'primitive':
      return second.kind === 'primitive' && first.name === second.name;
    case 'nominal':
      return (
        second.kind === 'nominal' &&
        first.entity === second.entity &&
        sameTypes(first.arguments, second.arguments)
      );
    case 'anonymous':
      return (
        second.kind === 'anonymous' &&
        first.origin === second.origin &&
        sameTypes(
          first.fields.map((field) => field.type),
          second.fields.map((field) => field.type),
        )
      );
    case 'tuple':
      return second.kind === 'tuple' && sameTypes(first.elements, second.elements);
    case 'function':
      return (
        second.kind === 'function' &&
        first.isAsync === second.isAsync &&
        first.parameters.length === second.parameters.length &&
        first.parameters.every((parameter, index) => {
          const other = second.parameters[index];
          return (
            other !== undefined &&
            parameter.reference === other.reference &&
            sameType(parameter.type, other.type)
          );
        }) &&
        sameType(first.result, second.result)
      );
    case 'parameter':
      return second.kind === 'parameter' && first.declaration === second.declaration;
    case 'error':
      return second.kind === 'error';
    default: {
      const unhandled: never = first;
      return unhandled;
    }
  }
}

function sameTypes(first: readonly Type[], second: readonly Type[]): boolean {
  return (
    first.length === second.length &&
    first.every((type, index) => {
      const other = second[index];
      return other !== undefined && sameType(type, other);
    })
  );
}

/** Whether a value of type `source` fits where `target` is expected. */
export function isAssignable(source: Type, target: Type): boolean {
  return (
    source.kind === 'error' ||
    target.kind === 'error' ||
    isPrimitive(source, 'never') ||
    sameType(source, target)
  );
}

/**
 * Whether `==` and `!=` may compare values of these types (§3.9): one type on both sides. The
 * error type compares with anything, so one mistake is reported once, and so does `never`, which a
 * side that doesn't produce a value has.
 */
export function comparable(first: Type, second: Type): boolean {
  const unchecked = (type: Type) => type.kind === 'error' || isPrimitive(type, 'never');
  return unchecked(first) || unchecked(second) || sameType(first, second);
}

/** Type parameters mapped to the types that replace them. */
export type Substitution = ReadonlyMap<ParameterKey, Type>;

/** `type` with every type parameter in `substitution` replaced. */
export function substitute(type: Type, substitution: Substitution): Type {
  if (substitution.size === 0) {
    return type;
  }
  switch (type.kind) {
    case 'primitive':
    case 'error':
      return type;
    case 'parameter':
      return substitution.get(type.declaration) ?? type;
    case 'nominal':
      return {
        ...type,
        arguments: type.arguments.map((argument) => substitute(argument, substitution)),
      };
    case 'anonymous':
      return {
        ...type,
        fields: type.fields.map((field) => ({
          ...field,
          type: substitute(field.type, substitution),
        })),
      };
    case 'tuple':
      return {
        ...type,
        elements: type.elements.map((element) => substitute(element, substitution)),
      };
    case 'function':
      return substituteFunction(type, substitution);
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/** A function type with `substitution` applied, still a function type. */
export function substituteFunction(type: FunctionType, substitution: Substitution): FunctionType {
  return {
    ...type,
    parameters: type.parameters.map((parameter) => ({
      ...parameter,
      type: substitute(parameter.type, substitution),
    })),
    result: substitute(type.result, substitution),
  };
}

/** The types `type` is built from, one level down. */
export function typeChildren(type: Type): readonly Type[] {
  switch (type.kind) {
    case 'nominal':
      return type.arguments;
    case 'anonymous':
      return type.fields.map((field) => field.type);
    case 'tuple':
      return type.elements;
    case 'function':
      return [...type.parameters.map((parameter) => parameter.type), type.result];
    case 'primitive':
    case 'parameter':
    case 'error':
      return [];
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/** The type parameters `type` mentions, each once, in order of appearance. */
export function parametersIn(type: Type): readonly ParameterKey[] {
  if (type.kind === 'parameter') {
    return [type.declaration];
  }
  return [...new Set(typeChildren(type).flatMap(parametersIn))];
}

/** Whether `type` is, or is built from, the error type. */
export function mentionsError(type: Type): boolean {
  return type.kind === 'error' || typeChildren(type).some(mentionsError);
}
