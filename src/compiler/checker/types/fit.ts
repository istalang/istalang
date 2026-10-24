/**
 * Fitting a value where a type is expected (§2): the same type, or a `T` wrapped into `T?`. The
 * wrap is the language's one implicit conversion, and it applies as often as the expected type
 * nests optionals, so an `int` fits an `int??` by two wraps. A value that is already optional
 * fits its own optional type without one: `int?` fits `int?`, never `int??` by wrapping `int?`
 * when an exact fit exists.
 *
 * Which nominal type is `Optional` is the prelude's to say, so the caller passes its entity.
 */

import { isAssignable, isPrimitive, type NominalType, type Type } from './type.ts';

/** The entity of the prelude's `Optional`, or undefined in a program without the prelude. */
export type OptionalEntity = NominalType['entity'] | undefined;

/** How many wraps make `found` fit `expected`: 0 for an exact fit, undefined when nothing does. */
export function wrapsToFit(
  found: Type,
  expected: Type,
  optional: OptionalEntity,
): number | undefined {
  if (isAssignable(found, expected)) {
    return 0;
  }
  const inner = optionalInner(expected, optional);
  if (inner === undefined || isPrimitive(found, 'never')) {
    return undefined;
  }
  const wraps = wrapsToFit(found, inner, optional);
  return wraps === undefined ? undefined : wraps + 1;
}

/** `T` of an optional type `T?`; undefined for any other type. */
export function optionalInner(type: Type, optional: OptionalEntity): Type | undefined {
  return optional !== undefined && type.kind === 'nominal' && type.entity === optional
    ? type.arguments[0]
    : undefined;
}
