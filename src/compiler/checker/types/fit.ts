/**
 * Fitting a value where a type is expected (§2, §3.10, §3.14, §3.15): the same type, a value
 * converted into an `any` type its type meets, a plain function made async where an async function
 * of its parameters and result is expected, a one-element tuple and its element each where the
 * other is expected, or a `T` wrapped into `T?`. These are the language's implicit conversions.
 *
 * - The wrap applies as often as the expected type nests optionals, so an `int` fits an `int??` by
 *   two wraps. A value that is already optional fits its own optional type without one: `int?`
 *   fits `int?`, never `int??` by wrapping `int?` when an exact fit exists.
 * - A value is converted into an `any` type, made async, or converted between a one-element tuple
 *   and its element, only where that type itself is expected, so the conversion comes first and at
 *   most once: an `Email` fits `(any Notifier)?` by a conversion, then a wrap, and an
 *   `Array<fn()>` is never an `Array<async fn()>`. An `any` type converts into another whose
 *   constraints are among its own.
 * - Which nominal type is `Optional`, and whether a type meets a constraint, are the program's to
 *   say (`Fitting`).
 */

import {
  type AnyType,
  isAssignable,
  isPrimitive,
  type NominalEntity,
  sameShape,
  sameType,
  type Type,
} from './type.ts';

/** The entity of the prelude's `Optional`, or undefined in a program without the prelude. */
export type OptionalEntity = NominalEntity | undefined;

/**
 * What converts a value itself, before any wrap: nothing, the conversion into an `any` type, a
 * plain function made async, a value made a one-element tuple (`tupled`), or a one-element tuple's
 * element taken out (`untupled`).
 */
type Conversion =
  | { readonly kind: 'none' }
  | { readonly kind: 'any'; readonly to: AnyType }
  | { readonly kind: 'async' }
  | { readonly kind: 'tupled' }
  | { readonly kind: 'untupled' };

/** How a value fits: converted first, then wrapped into `T?` `wraps` times. */
export interface Fit {
  readonly conversion: Conversion;
  readonly wraps: number;
}

/** The fit of a value that has the expected type. */
export const exactFit: Fit = { conversion: { kind: 'none' }, wraps: 0 };

/** What fitting needs of the program: its `Optional`, and whether a type meets an `any` type's constraints. */
export interface Fitting {
  readonly optional: OptionalEntity;
  readonly meetsAny: (found: Type, target: AnyType) => boolean;
}

/** How `found` fits `expected`; undefined when nothing makes it fit. */
export function fitOf(found: Type, expected: Type, fitting: Fitting): Fit | undefined {
  if (isAssignable(found, expected)) {
    return exactFit;
  }
  if (fitsAsync(found, expected)) {
    return { conversion: { kind: 'async' }, wraps: 0 };
  }
  if (expected.kind === 'any') {
    return fitting.meetsAny(found, expected)
      ? { conversion: { kind: 'any', to: expected }, wraps: 0 }
      : undefined;
  }
  const single = singleConversion(found, expected);
  if (single !== undefined) {
    return { conversion: { kind: single }, wraps: 0 };
  }
  const inner = optionalInner(expected, fitting.optional);
  if (inner === undefined || isPrimitive(found, 'never')) {
    return undefined;
  }
  const fit = fitOf(found, inner, fitting);
  return fit === undefined ? undefined : { ...fit, wraps: fit.wraps + 1 };
}

/**
 * How `found` converts to `expected` between a one-element tuple and its element (§3.15): made one
 * where one of it is expected, or taken out where its element is; undefined when neither.
 */
function singleConversion(found: Type, expected: Type): 'tupled' | 'untupled' | undefined {
  const element = singleElement(expected);
  if (element !== undefined && isAssignable(found, element)) {
    return 'tupled';
  }
  const inside = singleElement(found);
  return inside !== undefined && isAssignable(inside, expected) ? 'untupled' : undefined;
}

/** The element of a one-element tuple type; undefined for any other type. */
export function singleElement(type: Type): Type | undefined {
  return type.kind === 'tuple' && type.elements.length === 1 ? type.elements[0] : undefined;
}

/** Whether `fit` changes a value's own shape, as a call taking it as it is wouldn't (§3.7). */
export function reshapes(fit: Fit): boolean {
  const { kind } = fit.conversion;
  return kind === 'async' || kind === 'tupled' || kind === 'untupled';
}

/**
 * Whether a plain function of type `source` fits where `target`, an async function of the same
 * parameters and result, is expected: calling it gives a future already resolved (§3.14).
 */
function fitsAsync(source: Type, target: Type): boolean {
  return (
    source.kind === 'function' &&
    target.kind === 'function' &&
    !source.isAsync &&
    target.isAsync &&
    (source.isSendable || !target.isSendable) &&
    sameShape(target, source, sameType)
  );
}

/** Whether `fit` converts nothing: the value has the expected type. */
export function isExact(fit: Fit): boolean {
  return fit.conversion.kind === 'none' && fit.wraps === 0;
}

/** `T` of an optional type `T?`; undefined for any other type. */
export function optionalInner(type: Type, optional: OptionalEntity): Type | undefined {
  return optional !== undefined && type.kind === 'nominal' && type.entity === optional
    ? type.arguments[0]
    : undefined;
}

/** `type` without every optional around it: `T` of `T`, `T?` and `T??`. */
export function withoutOptionals(type: Type, optional: OptionalEntity): Type {
  const inner = optionalInner(type, optional);
  return inner === undefined ? type : withoutOptionals(inner, optional);
}
