/**
 * Fitting a value where a type is expected (§2, §3.1, §3.10, §3.14, §3.15): the same type, a value
 * converted into an `any` type its type meets, a nominal struct's value into its equal shape, a
 * plain function made async where an async function of its parameters and result is expected, a
 * one-element tuple and its element each where the other is expected, or a `T` wrapped into `T?`.
 * These are the language's implicit conversions.
 *
 * - The wrap applies as often as the expected type nests optionals, so an `Int` fits an `Int??` by
 *   two wraps. A value that is already optional fits its own optional type without one: `Int?`
 *   fits `Int?`, never `Int??` by wrapping `Int?` when an exact fit exists.
 * - A value is converted into an `any` type or a shape, made async, or converted between a
 *   one-element tuple and its element, only where that type itself is expected, so the conversion
 *   comes first and at most once: an `Email` fits `(any Notifier)?` by a conversion, then a wrap,
 *   and an `Array<fn()>` is never an `Array<async fn()>`, nor an `Array<Pixel>` an
 *   `Array<{ x: Int; y: Int }>`. An `any` type converts into another whose constraints are among
 *   its own. A nominal struct's value converts into a shape its fields are, as the program says
 *   (`Fitting.shapeOf`); a shape never converts into a nominal struct.
 * - Which nominal type is `Optional`, and whether a type meets a constraint, are the program's to
 *   say (`Fitting`).
 * - The wrap is why a bare variant may be of an enum inside the optionals expected (§3.11): the
 *   checker chooses among them, and completion offers them, by `enumsExpected` and `sameEnum`.
 */

import type { EnumDeclaration } from '../../syntax/declarations.ts';
import { isAssignable } from './identity.ts';
import {
  type AnonymousStructType,
  type AnyType,
  isPrimitive,
  type NominalEntity,
  type NominalType,
  type Type,
} from './type.ts';

/** The entity of the prelude's `Optional`, or undefined in a program without the prelude. */
export type OptionalEntity = NominalEntity | undefined;

/**
 * What converts a value itself, before any wrap: nothing, the conversion into an `any` type or of a
 * nominal struct's value into a shape, a plain function made async, a value made a one-element tuple
 * (`tupled`), or a one-element tuple's element taken out (`untupled`).
 */
type Conversion =
  | { readonly kind: 'none' }
  | { readonly kind: 'any'; readonly to: AnyType }
  | { readonly kind: 'shape'; readonly to: AnonymousStructType }
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

/**
 * What fitting needs of the program: its `Optional`, whether a type meets an `any` type's
 * constraints, and the shape a nominal struct's value converts into, if any (§3.1).
 */
export interface Fitting {
  readonly optional: OptionalEntity;
  readonly meetsAny: (found: Type, target: AnyType) => boolean;
  readonly shapeOf: (found: Type) => AnonymousStructType | undefined;
}

/** How `matchConversion` compares leaf types and checks `any` conformance. */
export interface ConversionRules extends Fitting {
  readonly exact: (expected: Type, found: Type) => boolean;
}

/** How `found` fits `expected`; undefined when nothing makes it fit. */
export function fitOf(found: Type, expected: Type, fitting: Fitting): Fit | undefined {
  return matchConversion(found, expected, {
    ...fitting,
    exact: (target, source) => isAssignable(source, target),
  });
}

/**
 * How `found` fits `expected` under `rules` (§2, §3.10, §3.14, §3.15): exact, a plain function
 * made async, a one-element tuple and its element, a conversion into `any`, then optional wraps.
 */
export function matchConversion(
  found: Type,
  expected: Type,
  rules: ConversionRules,
): Fit | undefined {
  if (found.kind === 'error' || isPrimitive(found, 'Never') || rules.exact(expected, found)) {
    return exactFit;
  }
  if (fitsAsync(found, expected, rules.exact)) {
    return { conversion: { kind: 'async' }, wraps: 0 };
  }
  const single = singleConversion(found, expected, rules.exact);
  if (single !== undefined) {
    return { conversion: { kind: single }, wraps: 0 };
  }
  if (expected.kind === 'any') {
    return rules.meetsAny(found, expected)
      ? { conversion: { kind: 'any', to: expected }, wraps: 0 }
      : undefined;
  }
  if (expected.kind === 'anonymous') {
    const shape = rules.shapeOf(found);
    return shape !== undefined && rules.exact(expected, shape)
      ? { conversion: { kind: 'shape', to: expected }, wraps: 0 }
      : undefined;
  }
  const inner = optionalInner(expected, rules.optional);
  if (inner === undefined) {
    return undefined;
  }
  const fit = matchConversion(found, inner, rules);
  return fit === undefined ? undefined : { ...fit, wraps: fit.wraps + 1 };
}

/**
 * How `found` converts to `expected` between a one-element tuple and its element (§3.15): made one
 * where one of it is expected, or taken out where its element is; undefined when neither.
 */
function singleConversion(
  found: Type,
  expected: Type,
  exact: (expected: Type, found: Type) => boolean,
): 'tupled' | 'untupled' | undefined {
  const element = singleElement(expected);
  if (element !== undefined && exact(element, found)) {
    return 'tupled';
  }
  const inside = singleElement(found);
  return inside !== undefined && exact(expected, inside) ? 'untupled' : undefined;
}

/** The element of a one-element tuple type; undefined for any other type. */
export function singleElement(type: Type): Type | undefined {
  return type.kind === 'tuple' && type.elements.length === 1 ? type.elements[0] : undefined;
}

/**
 * Whether `fit` changes a value's own shape, as a call taking it as it is wouldn't (§3.7): made
 * async, a one-element tuple and its element, or a nominal struct's value as its shape.
 */
export function reshapes(fit: Fit): boolean {
  const { kind } = fit.conversion;
  return kind === 'async' || kind === 'tupled' || kind === 'untupled' || kind === 'shape';
}

/**
 * Whether a plain function of type `source` fits where `target`, an async function of the same
 * parameters and result, is expected: calling it gives a future already resolved (§3.14).
 */
function fitsAsync(
  source: Type,
  target: Type,
  exact: (expected: Type, found: Type) => boolean,
): boolean {
  return (
    source.kind === 'function' &&
    target.kind === 'function' &&
    !source.isAsync &&
    target.isAsync &&
    exact(target, { ...source, isAsync: true })
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

/**
 * The nominal type of `declaration` that `expected` asks for, through any optionals wrapping it
 * (§2); `Optional<T>` itself when `declaration` is `Optional`.
 */
export function sameEnum(
  checker: { readonly optionalEntity: OptionalEntity },
  expected: Type | undefined,
  declaration: EnumDeclaration,
): NominalType | undefined {
  for (
    let current = expected;
    current !== undefined;
    current = optionalInner(current, checker.optionalEntity)
  ) {
    if (current.kind === 'nominal' && current.entity.declaration === declaration) {
      return current;
    }
  }
  return undefined;
}

/**
 * The enums a value of `expected` may be a variant of: its own, and those inside its optionals,
 * outermost first, as `sameEnum` finds them.
 */
export function enumsExpected(
  checker: { readonly optionalEntity: OptionalEntity },
  expected: Type | undefined,
): readonly EnumDeclaration[] {
  const enums: EnumDeclaration[] = [];
  for (
    let current = expected;
    current !== undefined;
    current = optionalInner(current, checker.optionalEntity)
  ) {
    if (current.kind === 'nominal' && current.entity.declaration.kind === 'EnumDeclaration') {
      enums.push(current.entity.declaration);
    }
  }
  return enums;
}
