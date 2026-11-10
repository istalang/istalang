/**
 * The built-in types every program has (§2), as values of the type model (type/index.ts): each
 * primitive by its name, and tuples. A tuple is built through `tupleType`, which makes the empty
 * one the primitive `Unit` (§3.15), so `()` and `Unit` are one type wherever either is written, and
 * `tupleElements` reads `Unit` back as no elements.
 */

import type { PrimitiveName } from '../../../../foundation/language/primitives.ts';
import type { Persistence } from '../../../../foundation/language/well-known/index.ts';
import type { ErrorType, LiteralType, LiteralValue, PrimitiveType, Type } from './index.ts';

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

/** The literal type of `value`. */
export function literalType(value: LiteralValue): LiteralType {
  return { kind: 'literal', value };
}

/** The type of code of kind `kind` (proposal 8, Rules 1–2): its `Persistence` member, a literal. */
export function persistenceType(kind: Persistence): Type {
  return literalType(kind);
}
