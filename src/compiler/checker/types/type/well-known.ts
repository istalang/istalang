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
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import type { Checker } from '../../check.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { AwaitedType, Futures } from './function-types.ts';
import type { NominalType, Type } from './index.ts';
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

/**
 * `Future<T, K>`, what an async call of kind `mode` gives; the error type in a program without a
 * prelude.
 */
/** `_Cell<T>`, what a variable passed by `&` or shared with a closure lives in. */
export function cellTypeOf(checker: Pick<Checker, 'wellKnownType'>, type: Type): NominalType {
  const cell = checker.wellKnownType(wellKnown.cell, [type]);
  if (cell === undefined) {
    unreachable(
      "A variable needs a cell (passed by '&' or shared with a closure) in a program without a prelude.",
    );
  }
  return cell;
}

export function futureOf(checker: Pick<Checker, 'wellKnownType'>, value: Type, mode: Type): Type {
  return wellKnownOf(checker, wellKnown.future, [value, mode]);
}

/**
 * What awaiting a value of `type` gives when it is a future: a `Future<T, K>`'s `T`, awaited in kind
 * `K`; undefined for any other type. The one reading of a future's parts; what any awaitable gives is
 * read from its `onAwait` (`resolvedThrough`).
 */
export function awaitedOf(
  checker: Pick<Checker, 'wellKnownType'>,
  type: Type,
): AwaitedType | undefined {
  const [value, mode] = wellKnownArguments(checker, wellKnown.future, type) ?? [];
  return value === undefined || mode === undefined ? undefined : { value, mode };
}

/**
 * What a wait resolved through a resolver of `type` gives: a `Resolver<T, K>`'s `T`, waited for in
 * kind `K`; undefined for any other type. An awaitable's `onAwait` takes one, so it says what
 * awaiting the awaitable gives (proposal 8, Rule 5).
 */
export function resolvedThrough(
  checker: Pick<Checker, 'wellKnownType'>,
  type: Type,
): AwaitedType | undefined {
  const [value, mode] = wellKnownArguments(checker, wellKnown.resolver, type) ?? [];
  return value === undefined || mode === undefined ? undefined : { value, mode };
}

/** What a call giving `type` ends with: what awaiting it gives, or `type` itself. */
export function outcomeOf(checker: Pick<Checker, 'wellKnownType'>, type: Type): Type {
  return awaitedOf(checker, type)?.value ?? type;
}

/** The program's futures, as relating a function's result to one reads them. */
export function futuresOf(checker: Pick<Checker, 'wellKnownType'>): Futures {
  return {
    futureOf: (value, mode) => futureOf(checker, value, mode),
    awaitedOf: (type) => awaitedOf(checker, type),
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
