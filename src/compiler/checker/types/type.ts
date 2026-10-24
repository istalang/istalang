/**
 * The checker's model of types (§2): what every expression, variable and signature has.
 *
 * - Types are plain immutable values compared by structure, except nominal types, which compare by
 *   the identity of the binder's entity for their declaration (§3.1: two declarations are two
 *   types even with identical fields). Entities live as long as their tree, so a type stays valid
 *   across Program snapshots that keep the declaring module.
 * - A nominal type carries its type arguments; field and variant types are derived on demand by
 *   substituting them (the checker's `fieldsOf` and `variantsOf`), never stored per instantiation.
 * - `error` stands for a type a diagnostic has already explained. It is compatible with everything,
 *   so one mistake is reported once instead of at every use that follows.
 * - `never` (§2) is the type of expressions that don't produce a value, and fits wherever any type
 *   is expected.
 */

import type { PrimitiveName, TypeEntity } from '../../binder/entities.ts';
import type {
  EnumDeclaration,
  ExternStructDeclaration,
  StructDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';

export interface PrimitiveType {
  readonly kind: 'primitive';
  readonly name: PrimitiveName;
}

/** The declarations a nominal type can come from. */
export type NominalDeclaration = StructDeclaration | EnumDeclaration | ExternStructDeclaration;

/** A declared struct, enum or extern type, with its type arguments. */
export interface NominalType {
  readonly kind: 'nominal';
  readonly entity: TypeEntity & { readonly declaration: NominalDeclaration };
  readonly arguments: readonly Type[];
}

export interface TupleType {
  readonly kind: 'tuple';
  readonly elements: readonly Type[];
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

/** A type parameter, opaque inside the declaration that introduces it (§3.5). */
export interface TypeParameterType {
  readonly kind: 'parameter';
  readonly declaration: TypeParameter;
}

export interface ErrorType {
  readonly kind: 'error';
}

export type Type =
  | PrimitiveType
  | NominalType
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
export type Substitution = ReadonlyMap<TypeParameter, Type>;

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
    case 'tuple':
      return {
        ...type,
        elements: type.elements.map((element) => substitute(element, substitution)),
      };
    case 'function':
      return {
        ...type,
        parameters: type.parameters.map((parameter) => ({
          ...parameter,
          type: substitute(parameter.type, substitution),
        })),
        result: substitute(type.result, substitution),
      };
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
