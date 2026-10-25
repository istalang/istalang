/**
 * Futures in types (§3.3, §6): `Future<T>`, the read-only view of a slot, and the `T` it gives.
 *
 * A future is a value like any other (§7: it may be returned or stored freely), so nothing here
 * restricts where one goes; leaving one unused is must-use.ts's rule.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { Checker } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { errorType, type Type } from '../types/type.ts';
import { wellKnownArguments } from '../types/well-known.ts';

/** `Future<T>`, what an async call returns; the error type in a program without a prelude. */
export function futureOf(checker: CheckerContext, value: Type): Type {
  return checker.wellKnownType(wellKnown.future, [value]) ?? errorType;
}

/** `T` when `type` is `Future<T>`; undefined for any other type. */
export function futureArgument(
  checker: Pick<Checker, 'wellKnownType'>,
  type: Type,
): Type | undefined {
  return wellKnownArguments(checker, wellKnown.future, type)?.[0];
}
