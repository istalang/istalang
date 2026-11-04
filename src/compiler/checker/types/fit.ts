/**
 * Fitting a value where a type is expected (§2, §3.1, §3.10, §3.14, §3.15): the same type, a value
 * converted into an `any` type its type meets, a nominal struct's value into its equal shape, a
 * plain function made async where an async function of its parameters and result is expected, a
 * one-element tuple and its element each where the other is expected, a literal type's value as
 * its base, or a value put into a union. These are the language's implicit conversions.
 *
 * - A value goes into a union as the member of its own type, else as the one member it converts
 *   into by one of the conversions above; converting into several is no fit, which the caller
 *   reports as such (`intoSeveral`). A union goes into a union holding each of its members, or
 *   their literals' bases. `T?` is `T | None`, so `Int` fits `Int?` as its `Int` member, and an
 *   `Int?` fits an `Int?` exactly.
 * - A value is converted into an `any` type or a shape, made async, or converted between a
 *   one-element tuple and its element, only where that type itself is expected, or a member of the
 *   union expected is, so the conversion comes first and at most once, then the value goes into
 *   the union: an `Email` fits `(any Notifier)?`, and an `Array<fn()>` is never an
 *   `Array<async fn()>`, nor an `Array<Int>` an `Array<Int?>`. An `any` type converts into another
 *   whose constraints are among its own. A nominal struct's value converts into a shape its fields
 *   are, as the program says (`Fitting.shapeOf`); a shape never converts into a nominal struct.
 * - A member written with a type parameter is tried after the members without one, so inference
 *   binds it only to what the others don't take (§3.5): `T?` given an `Int?` binds `T` to `Int`.
 * - Whether a type meets a constraint is the program's to say (`Fitting`).
 * - A member parameter's value (`T in U`, §3.5) fits where its own type doesn't as a value of `U`
 *   does: it is one member of `U`, which each instantiation makes concrete.
 */

import { isAssignable } from './identity.ts';
import {
  type AnonymousStructType,
  type AnyType,
  isPrimitive,
  type ParameterKey,
  type Type,
  type UnionType,
} from './type.ts';
import { parametersIn } from './type-parts.ts';
import { baseOf, hasMember, membersOf } from './unions.ts';

/**
 * What converts a value itself, before it goes into a union: nothing, the conversion into an `any`
 * type or of a nominal struct's value into a shape, a plain function made async, a value made a
 * one-element tuple (`tupled`), a one-element tuple's element taken out (`untupled`), or a literal
 * type's value, or a union of literals', taken as their base (`base`).
 */
type Conversion =
  | { readonly kind: 'none' }
  | { readonly kind: 'any'; readonly to: AnyType }
  | { readonly kind: 'shape'; readonly to: AnonymousStructType }
  | { readonly kind: 'async' }
  | { readonly kind: 'tupled' }
  | { readonly kind: 'untupled' }
  | { readonly kind: 'base' };

/**
 * How a value fits: converted first, then, where `into` is given, put into that union, as its
 * `member` the converted value is a value of, or member by member from the union it is.
 */
export interface Fit {
  readonly conversion: Conversion;
  readonly into?: IntoUnion | undefined;
}

/** A value put into `union`: as its `member`, or, without one, member by member from a union. */
interface IntoUnion {
  readonly union: UnionType;
  readonly member?: Type | undefined;
}

/** The fit of a value that has the expected type. */
export const exactFit: Fit = { conversion: { kind: 'none' } };

/**
 * What fitting needs of the program: whether a type meets an `any` type's constraints, the shape a
 * nominal struct's value converts into, if any (§3.1), and the union a member parameter stands
 * for one member of (§3.5).
 */
export interface Fitting {
  readonly meetsAny: (found: Type, target: AnyType) => boolean;
  readonly shapeOf: (found: Type) => AnonymousStructType | undefined;
  readonly memberUnionOf: (parameter: ParameterKey) => Type | undefined;
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
 * How `found` fits `expected` under `rules` (§2, §3.10, §3.14, §3.15): exact, converted once, or put
 * into a union, converted first.
 */
export function matchConversion(
  found: Type,
  expected: Type,
  rules: ConversionRules,
): Fit | undefined {
  return ownConversion(found, expected, rules) ?? memberParameterFit(found, expected, rules);
}

/** How `found` fits `expected` as its own type, as `matchConversion` says. */
function ownConversion(found: Type, expected: Type, rules: ConversionRules): Fit | undefined {
  if (found.kind === 'error' || isPrimitive(found, 'Never') || rules.exact(expected, found)) {
    return exactFit;
  }
  if (expected.kind !== 'union') {
    const conversion = convertedInto(found, expected, rules);
    return conversion === undefined ? undefined : { conversion };
  }
  if (found.kind === 'union') {
    return found.members.every((member) => intoMember(member, expected, rules) !== undefined)
      ? { conversion: { kind: 'none' }, into: { union: expected } }
      : intoAnyMember(found, expected, rules);
  }
  const [only, ...others] = membersTaking(found, expected, rules);
  return only === undefined || others.length > 0
    ? undefined
    : { conversion: only.conversion, into: { union: expected, member: only.member } };
}

/**
 * How a value of a member parameter `found` fits where its own type doesn't (§3.5): as its union's
 * values do, since it is one of them. Into a union holding every member of its own, it goes as
 * itself, which each instantiation makes the member it stands for; else as its union converts.
 */
function memberParameterFit(found: Type, expected: Type, rules: ConversionRules): Fit | undefined {
  const union = found.kind === 'parameter' ? rules.memberUnionOf(found.declaration) : undefined;
  if (union === undefined) {
    return undefined;
  }
  if (
    expected.kind === 'union' &&
    membersOf(union).every((member) => hasMember(expected, member))
  ) {
    return { conversion: { kind: 'none' }, into: { union: expected, member: found } };
  }
  return matchConversion(union, expected, rules);
}

/** How `found`, no union, converts into `expected`, no union either; undefined when it can't. */
function convertedInto(
  found: Type,
  expected: Type,
  rules: ConversionRules,
): Conversion | undefined {
  if (fitsAsync(found, expected, rules.exact)) {
    return { kind: 'async' };
  }
  const single = singleConversion(found, expected, rules.exact);
  if (single !== undefined) {
    return { kind: single };
  }
  if (expected.kind === 'any') {
    return rules.meetsAny(found, expected) ? { kind: 'any', to: expected } : undefined;
  }
  if (expected.kind === 'anonymous') {
    const shape = rules.shapeOf(found);
    return shape !== undefined && rules.exact(expected, shape)
      ? { kind: 'shape', to: expected }
      : undefined;
  }
  return isLiteralOf(found, expected) ? { kind: 'base' } : undefined;
}

/** Whether `found` is a literal type, or a union of literals, all of `base`'s base. */
function isLiteralOf(found: Type, base: Type): boolean {
  return membersOf(found).every(
    (member) => member.kind === 'literal' && isAssignable(baseOf(member), base),
  );
}

/**
 * A union converted whole into the one `any` member of `expected` that each of its members meets,
 * then put into it (§6): `Email | Sms` fits `(any Named)?`; undefined when no one member takes it.
 */
function intoAnyMember(
  found: UnionType,
  expected: UnionType,
  rules: ConversionRules,
): Fit | undefined {
  const [only, ...others] = expected.members.filter(
    (member): member is AnyType => member.kind === 'any' && rules.meetsAny(found, member),
  );
  return only === undefined || others.length > 0
    ? undefined
    : { conversion: { kind: 'any', to: only }, into: { union: expected, member: only } };
}

/** A member of `expected` that `member`, a member of a union found, goes into; or undefined. */
function intoMember(member: Type, expected: UnionType, rules: ConversionRules): Type | undefined {
  return (
    ownMember(member, expected, rules) ??
    (member.kind === 'literal' && hasMember(expected, baseOf(member)) ? baseOf(member) : undefined)
  );
}

/**
 * The member of `expected` that is `found`'s own type: one written without a type parameter, else
 * one written with one that takes it, so inference binds a parameter only to what the others
 * don't take (§3.5).
 */
function ownMember(found: Type, expected: UnionType, rules: ConversionRules): Type | undefined {
  const isGeneric = (member: Type) => parametersIn(member).length > 0;
  return (
    expected.members.find((member) => !isGeneric(member) && rules.exact(member, found)) ??
    expected.members.find((member) => isGeneric(member) && rules.exact(member, found))
  );
}

/**
 * The members of the union `expected` that a value of `found`, no union, goes into, with how it
 * converts: its own type's member (`ownMember`), else each member it converts into.
 */
function membersTaking(
  found: Type,
  expected: UnionType,
  rules: ConversionRules,
): readonly { readonly member: Type; readonly conversion: Conversion }[] {
  const own = ownMember(found, expected, rules);
  if (own !== undefined) {
    return [{ member: own, conversion: { kind: 'none' } }];
  }
  return expected.members.flatMap((member) => {
    const conversion = convertedInto(found, member, rules);
    return conversion === undefined ? [] : [{ member, conversion }];
  });
}

/**
 * Whether a value of `found` would go into a union `expected` as several of its members, each by
 * a conversion: a fit refused as ambiguous rather than as a mismatch.
 */
export function intoSeveral(found: Type, expected: Type, fitting: Fitting): boolean {
  if (expected.kind !== 'union' || found.kind === 'union') {
    return false;
  }
  const rules = { ...fitting, exact: (target: Type, source: Type) => isAssignable(source, target) };
  return membersTaking(found, expected, rules).length > 1;
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
  return fit.conversion.kind === 'none' && fit.into === undefined;
}
