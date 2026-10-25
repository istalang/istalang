/**
 * Recognizing the well-known types (language/well-known.ts) in checked types: whether a type is,
 * say, a `Future<T>` or an `Array<T>`, and with which type arguments. A type is recognized by its
 * declaration's entity, the one the prelude or `time` declares, never by its name, so a program's
 * own `Array` would be a different type.
 */

import type { WellKnownDeclaration } from '../../../language/well-known.ts';
import type { CheckerContext } from '../context.ts';
import { errorType, type Type } from './type.ts';

/**
 * The type arguments of `type` when it is the well-known `declaration`, such as `[T]` for an
 * `Array<T>`; undefined for any other type, and in a program without the declaring module.
 */
export function wellKnownArguments(
  checker: CheckerContext,
  declaration: WellKnownDeclaration,
  type: Type,
): readonly Type[] | undefined {
  const known = checker.wellKnownType(declaration);
  if (type.kind !== 'nominal' || known?.kind !== 'nominal' || type.entity !== known.entity) {
    return undefined;
  }
  return type.arguments;
}

/** The well-known `declaration` with `typeArguments`; the error type without its module. */
export function wellKnownOf(
  checker: CheckerContext,
  declaration: WellKnownDeclaration,
  typeArguments: readonly Type[] = [],
): Type {
  return checker.wellKnownType(declaration, typeArguments) ?? errorType;
}
