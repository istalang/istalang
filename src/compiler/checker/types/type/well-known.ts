/**
 * Recognizing the well-known types (foundation/language/well-known/index.ts) in checked types:
 * whether a type is, say, a `Future<T>` or an `Array<T>`, and with which type arguments. A type is
 * recognized by its declaration's entity, the one the prelude or `time` declares, never by its
 * name, so a program's own `Array` would be a different type.
 */

import {
  type WellKnownDeclaration,
  wellKnown,
} from '../../../../foundation/language/well-known/index.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import type { Checker } from '../../check.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Futures } from './function-types.ts';
import type { Type } from './index.ts';
import { errorType } from './primitives.ts';

/**
 * The type arguments of `type` when it is the well-known `declaration`, such as `[T]` for an
 * `Array<T>`; undefined for any other type, and in a program without the declaring module.
 */
export function wellKnownArguments(
  checker: Pick<Checker, 'wellKnownType'>,
  declaration: WellKnownDeclaration,
  type: Type,
): readonly Type[] | undefined {
  const known = checker.wellKnownType(declaration);
  if (type.kind !== 'nominal' || type.entity !== known?.entity) {
    return undefined;
  }
  return type.arguments;
}

/** The well-known `declaration` with `typeArguments`; the error type without its module. */
export function wellKnownOf(
  checker: Pick<Checker, 'wellKnownType'>,
  declaration: WellKnownDeclaration,
  typeArguments: readonly Type[] = [],
): Type {
  return checker.wellKnownType(declaration, typeArguments) ?? errorType;
}

/** `Future<T>`, what an async call returns; the error type in a program without a prelude. */
export function futureOf(checker: Pick<Checker, 'wellKnownType'>, value: Type): Type {
  return wellKnownOf(checker, wellKnown.future, [value]);
}

/** `T` when `type` is `Future<T>`; undefined for any other type. */
export function futureArgument(
  checker: Pick<Checker, 'wellKnownType'>,
  type: Type,
): Type | undefined {
  return wellKnownArguments(checker, wellKnown.future, type)?.[0];
}

/** The program's futures, as relating a function's result to one reads them. */
export function futuresOf(checker: Pick<Checker, 'wellKnownType'>): Futures {
  return {
    futureOf: (value) => futureOf(checker, value),
    futureValue: (type) => futureArgument(checker, type),
  };
}

/** `Array<T>`, what an array literal or comprehension builds; the error type without a prelude. */
export function arrayOf(checker: CheckerContext, element: Type): Type {
  return wellKnownOf(checker, wellKnown.array, [element]);
}

/** `T` when `type` is `Array<T>`; undefined for any other type. */
export function arrayElement(
  checker: Pick<Checker, 'wellKnownType'>,
  type: Type,
): Type | undefined {
  return wellKnownArguments(checker, wellKnown.array, type)?.[0];
}

/** Whether `trait` is the well-known trait `declaration` names. */
export function isWellKnownTrait(
  checker: CheckerContext,
  trait: TraitDeclaration,
  declaration: WellKnownDeclaration,
): boolean {
  const entity = checker.wellKnownEntity(declaration);
  return entity?.kind === 'type' && entity.declaration === trait;
}
