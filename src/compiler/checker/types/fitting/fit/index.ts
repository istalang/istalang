/**
 * Fitting a value where a type is expected (§2, §3.1, §3.5, §3.10, §3.14, §3.15): the same type, a
 * value converted into an `any` type its type meets, a nominal struct's value into its equal shape,
 * a function made async where one of its parameters giving a future of its result is expected, a
 * one-element tuple and its element each where the other is expected, a literal type's value as its
 * base, or a value put into a union. These are the language's implicit conversions.
 *
 * - A value goes into a union as the member of its own type, else as the one member it converts
 *   into by one of the conversions above; converting into several is no fit, which the caller
 *   reports as such (`intoSeveral`). A union goes into a union holding each of its members, or
 *   their literals' bases. `T?` is `T | None`, so `Int` fits `Int?` as its `Int` member, and an
 *   `Int?` fits an `Int?` exactly.
 * - A value is converted into an `any` type or a shape, made async, or converted between a
 *   one-element tuple and its element where that type itself is expected, or a member of the union
 *   expected is, so the conversion comes first and at most once, then the value goes into the
 *   union: an `Email` fits `(any Notifier)?`. An `any` type converts into another whose
 *   constraints are among its own. A nominal struct's value converts into a shape its fields are,
 *   as the program says (`Fitting.shapeOf`); a shape never converts into a nominal struct. A
 *   recursive type's value is its body's, one type (§3.17), so it goes in and out as what it
 *   unfolds to.
 * - Where none of those fits, a value whose type is built of others converts part by part, each
 *   part as the variance of what holds it allows (§3.5, parts.ts): an `Array<fn()>` is an
 *   `Array<async fn()>`, and an `Array<Int>` an `Array<Int?>`; so does a union whose members each
 *   fit, one by its parts. A part converts as any value does, but for the conversion between a
 *   one-element tuple and its element, which stays at the top (§3.15).
 * - A member written with a type parameter is tried after the members without one, so inference
 *   binds it only to what the others don't take (§3.5): `T?` given an `Int?` binds `T` to `Int`.
 * - Whether a type meets a constraint is the program's to say (`Fitting`).
 * - A member parameter's value (`T in U`, §3.5) fits where its own type doesn't as a value of `U`
 *   does: it is one member of `U`, which each instantiation makes concrete.
 * - Why a value doesn't fit is worded once for every place that reports it, a value's own check and
 *   a call's argument alike (`misfitOf`): it converts into several members of the union expected,
 *   which makes no fit rather than a guess, or it doesn't fit at all.
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import type { TraitDeclaration } from '../../../../syntax/declarations/index.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import {
  isAssignable,
  isAssignableInvariantly,
  sameConstraint,
  sameType,
} from '../../identity/identity.ts';
import { UnfoldingPairs } from '../../identity/unfolding-pairs.ts';
import { parametersIn } from '../../parts/type-parts.ts';
import { type AssociatedOfType, unfolded } from '../../type/computed-types.ts';
import { type Futures, madeAsync } from '../../type/function-types.ts';
import type {
  AnonymousStructType,
  AnyType,
  Constraint,
  FunctionType,
  ParameterKey,
  Type,
  TypeParameterType,
  UnionType,
} from '../../type/index.ts';
import type { QualifierParameter } from '../../type/mark-orders.ts';
import { isPrimitive } from '../../type/primitives.ts';
import type { TypeRules } from '../../type/type-rules.ts';
import { typeText } from '../../type/type-text.ts';
import { absorbingMember, baseOf } from '../../unions/union-members.ts';
import { hasMember, literalsBase, membersOf } from '../../unions/unions.ts';
import type { Variance } from '../../variance/lattice.ts';
import type { VariedDeclaration } from '../../variance/variance.ts';
import type { MetInstantiation, ProposedInstantiation } from '../met-instantiation.ts';
import { argumentsFitAs, fitsByParts, type PartsRelation } from './parts.ts';

/**
 * What converts a value itself, before it goes into a union: nothing, the conversion into an `any`
 * type or of a nominal struct's value into a shape, a plain function made async (`to`), a value made a
 * one-element tuple (`tupled`), a one-element tuple's element taken out (`untupled`), a literal
 * type's value, or a union of literals', taken as their base (`base`), or the value's parts each
 * converted into `to`'s (`parts`). A conversion of parts says only what it converts into, never
 * how: an instantiation may make it nothing, and lowering derives the rest from the two types as
 * the instantiation made them.
 */
type Conversion =
  | { readonly kind: 'none' }
  | { readonly kind: 'any'; readonly to: AnyType }
  | { readonly kind: 'shape'; readonly to: AnonymousStructType }
  | { readonly kind: 'async'; readonly to: FunctionType }
  | { readonly kind: 'tupled' }
  | { readonly kind: 'untupled' }
  | { readonly kind: 'base' }
  | { readonly kind: 'parts'; readonly to: Type };

/**
 * How a value fits: converted first, then, where `into` is given, put into that union, as its
 * `member` the converted value is a value of, or member by member from the union it is.
 */
export interface Fit {
  readonly conversion: Conversion;
  readonly into?: IntoUnion | undefined;
}

/**
 * A value put into `union`: as its `member`, or, without one, member by member from a union. An
 * instantiation may absorb the member into an `any` member, or collapse the union into the `any`
 * type that took the others whole (§2, §3.5), which lowering derives where the value then goes.
 */
interface IntoUnion {
  readonly union: UnionType | AnyType;
  readonly member?: Type | undefined;
}

/** The fit of a value that has the expected type. */
export const exactFit: Fit = { conversion: { kind: 'none' } };

/**
 * What fitting needs of the program: the rules types are built by (../../type/type-rules.ts),
 * whether a type meets an `any` type's constraints, the shape a nominal struct's value converts
 * into, if any (§3.1), the union a member parameter stands for one member of (§3.5), and the futures
 * an async function's call gives (§3.14).
 */
export interface Fitting extends TypeRules, Futures {
  readonly meetsAny: (found: Type, target: AnyType) => boolean;
  readonly shapeOf: (found: Type) => AnonymousStructType | undefined;
  /**
   * The union a member parameter type stands for one member of: the one it carries, or its declared
   * one; or the one an associated type of a type not known yet is bounded by (`type Mode in U`).
   */
  readonly memberUnionOf: (type: TypeParameterType | AssociatedOfType) => Type | undefined;
  /**
   * What a variable standing for a mark or a sendability qualifies functions by
   * (types/properties/qualifiers.ts): the order its bounds agree and join by; undefined for any
   * other.
   */
  readonly qualifierOf: (parameter: ParameterKey) => QualifierParameter | undefined;
  /** How each of a declaration's type parameters relates its instantiations (§3.5). */
  readonly varianceOf: (declaration: VariedDeclaration) => readonly Variance[];
  /**
   * The instantiation of `constraint`'s trait `found` meets in its place, through the trait's
   * variance (§3.10), the program's one answer per type and constraint.
   */
  readonly metInstantiation: (found: Type, constraint: Constraint) => MetInstantiation;
  /**
   * The instantiations of `trait` a value of `found` may meet, each of its parameters found, none
   * sought (§3.10): what inference relates a value through where an `any` type is expected, those
   * of a type holding variables judged once they are known.
   */
  readonly proposedInstantiations: (
    found: Type,
    trait: TraitDeclaration,
  ) => readonly ProposedInstantiation[];
}

/**
 * How `matchConversion` compares leaf types: `exact` where a value fits as it is, `same` where a
 * part must be the very type (invariant, or behind `&`), `exact` unless given, and `ordered` where
 * a function's mark or sendability must be at or below another's, by its order unless given. A probe that may
 * fail inside a match runs through `attempt`, so rules that keep state (inference's bounds) can
 * leave none behind when it does, and one of several tried to count those that hold through
 * `trial`, which leaves none behind either way.
 */
export interface ConversionRules extends Fitting {
  readonly exact: (expected: Type, found: Type) => boolean;
  readonly same?: ((expected: Type, found: Type) => boolean) | undefined;
  readonly ordered?: PartsRelation['ordered'] | undefined;
  readonly attempt?: ((probe: () => boolean) => boolean) | undefined;
  readonly trial?: ((probe: () => boolean) => boolean) | undefined;
}

/**
 * `ConversionRules` inside one match: the pairs of types whose parts are being related, and the
 * match itself, which parts are fitted by.
 */
interface Matching
  extends Omit<ConversionRules, 'same' | 'ordered' | 'attempt' | 'trial'>,
    PartsRelation {
  readonly attempt: (probe: () => boolean) => boolean;
  readonly trial: (probe: () => boolean) => boolean;
}

/** How `found` fits `expected`; undefined when nothing makes it fit. */
export function fitOf(found: Type, expected: Type, fitting: Fitting): Fit | undefined {
  return matchConversion(found, expected, {
    ...fitting,
    exact: (target, source) => isAssignable(source, target, fitting),
    same: (target, source) => isAssignableInvariantly(source, target, fitting),
  });
}

/**
 * How `found` fits `expected` under `rules` (§2, §3.10, §3.14, §3.15): exact, converted once, or
 * put into a union, converted first.
 */
export function matchConversion(
  found: Type,
  expected: Type,
  rules: ConversionRules,
): Fit | undefined {
  return matched(found, expected, matchingWith(rules));
}

/**
 * `rules` made the rules of one match. A part fits as any value does, but for the conversion
 * between a one-element tuple and its element, which stays at the top (§3.15): an `Array<(T,)>` is
 * no `Array<T>`, else the two would fit each other.
 */
function matchingWith(rules: ConversionRules): Matching {
  const matching: Matching = {
    ...rules,
    same: rules.same ?? rules.exact,
    ordered: rules.ordered ?? ((order, lower, upper) => order.below(lower, upper, sameType)),
    attempt: rules.attempt ?? ((probe) => probe()),
    trial: rules.trial ?? ((probe) => probe()),
    relating: new UnfoldingPairs(),
    fits: (found, expected) => {
      const fit = matched(found, expected, matching);
      return fit !== undefined && !retuples(fit);
    },
  };
  return matching;
}

/** Whether `fit` makes a value a one-element tuple, or takes one's element out. */
function retuples({ conversion }: Fit): boolean {
  return conversion.kind === 'tupled' || conversion.kind === 'untupled';
}

/** `matchConversion` inside one match, whose parts share its pairs being related. */
function matched(found: Type, expected: Type, rules: Matching): Fit | undefined {
  const value = unfolded(found);
  const place = unfolded(expected);
  return ownConversion(value, place, rules) ?? memberParameterFit(value, place, rules);
}

/** How `found` fits `expected` as its own type, as `matchConversion` says. */
function ownConversion(found: Type, expected: Type, rules: Matching): Fit | undefined {
  if (found.kind === 'error' || isPrimitive(found, 'Never') || rules.exact(expected, found)) {
    return exactFit;
  }
  if (expected.kind !== 'union') {
    const conversion = convertedInto(found, expected, rules);
    if (conversion !== undefined) {
      return { conversion };
    }
    return found.kind === 'union' && hasParts(expected)
      ? membersConverted(found, expected, rules)
      : undefined;
  }
  if (found.kind === 'union') {
    return rules.attempt(() =>
      found.members.every((member) => intoMember(member, expected, rules) !== undefined),
    )
      ? { conversion: { kind: 'none' }, into: { union: expected } }
      : (intoAnyMember(found, expected, rules) ?? membersConverted(found, expected, rules));
  }
  return intoOneMember(found, expected, rules);
}

/**
 * A value of `found`, no union, put into the one member of the union `expected` it goes into: its
 * own type's (`ownMember`), else the one it converts into; undefined for none or several.
 */
function intoOneMember(found: Type, expected: UnionType, rules: Matching): Fit | undefined {
  const own = ownMember(found, expected, rules);
  if (own !== undefined) {
    return { conversion: { kind: 'none' }, into: { union: expected, member: own } };
  }
  const [only, ...others] = membersConverting(found, expected, rules);
  const conversion = only === undefined ? undefined : convertedInto(found, unfolded(only), rules);
  return conversion === undefined || others.length > 0
    ? undefined
    : { conversion, into: { union: expected, member: only } };
}

/**
 * How a value of a member parameter `found` fits where its own type doesn't (§3.5): as its union's
 * values do, since it is one of them. Into a union holding every member of its own, it goes as
 * itself, which each instantiation makes the member it stands for; else as its union converts.
 */
function memberParameterFit(found: Type, expected: Type, rules: Matching): Fit | undefined {
  const union = found.kind === 'parameter' ? rules.memberUnionOf(found) : undefined;
  if (union === undefined) {
    return undefined;
  }
  if (
    expected.kind === 'union' &&
    membersOf(union).every((member) => hasMember(expected, member))
  ) {
    return { conversion: { kind: 'none' }, into: { union: expected, member: found } };
  }
  return matched(union, expected, rules);
}

/** How `found`, no union, converts into `expected`, no union either; undefined when it can't. */
function convertedInto(found: Type, expected: Type, rules: Matching): Conversion | undefined {
  const made = asyncFitOf(found, expected, rules);
  if (made !== undefined) {
    return { kind: 'async', to: made };
  }
  const single = singleConversion(found, expected, rules.exact);
  if (single !== undefined) {
    return { kind: single };
  }
  if (expected.kind === 'any') {
    return rules.meetsAny(found, expected) ? { kind: 'any', to: expected } : undefined;
  }
  if (expected.kind === 'anonymous') {
    const shape = found.kind === 'anonymous' ? found : rules.shapeOf(found);
    if (shape !== undefined && rules.exact(expected, shape)) {
      return { kind: 'shape', to: expected };
    }
  }
  if (isLiteralOf(found, expected, rules)) {
    return { kind: 'base' };
  }
  return rules.attempt(() => fitsByParts(found, expected, rules))
    ? { kind: 'parts', to: expected }
    : undefined;
}

/** Whether `type` is built of parts a conversion may convert one by one (§3.5). */
function hasParts(type: Type): boolean {
  return (
    type.kind === 'nominal' ||
    type.kind === 'tuple' ||
    type.kind === 'anonymous' ||
    type.kind === 'function'
  );
}

/**
 * A union whose members each fit `expected`, one converted by its parts at least, so the whole union
 * converts member by member (§3.5): `Int | Array<Int>` into `Int? | Array<Int?>`, and, as an
 * instantiation may collapse the union expected, `Array<Int?> | Array<Int>` into `Array<Int?>`,
 * a type built of parts; never into a type parameter, which a union fills only as a whole.
 */
function membersConverted(found: UnionType, expected: Type, rules: Matching): Fit | undefined {
  return rules.attempt(() => found.members.every((member) => rules.fits(member, expected)))
    ? { conversion: { kind: 'parts', to: expected } }
    : undefined;
}

/**
 * Whether `found` is a literal type, or a union of literals, all of `base`'s base; the keys of a
 * struct not known yet are String literals too (§3.1).
 */
function isLiteralOf(found: Type, base: Type, futures: Pick<Futures, 'awaitedOf'>): boolean {
  return membersOf(found).every(
    (member) =>
      (member.kind === 'literal' || member.kind === 'keys') &&
      isAssignable(baseOf(member), base, futures),
  );
}

/**
 * A union converted whole into the one `any` member of `expected` that each of its members meets,
 * then put into it (§6): `Email | Sms` fits `(any Named)?`; undefined when no one member takes it.
 */
function intoAnyMember(found: UnionType, expected: UnionType, rules: Matching): Fit | undefined {
  const [only, ...others] = expected.members.filter(
    (member): member is AnyType =>
      member.kind === 'any' && rules.trial(() => rules.meetsAny(found, member)),
  );
  return only === undefined || others.length > 0 || !rules.meetsAny(found, only)
    ? undefined
    : { conversion: { kind: 'any', to: only }, into: { union: expected, member: only } };
}

/**
 * A member of `expected` that `member`, a member of a union found, goes into: its own, its base
 * when it is a literal or a member parameter standing for one (`literalsBase`), or the `any`
 * member that takes it whole (§2), which holds it as its own type; or undefined.
 */
function intoMember(member: Type, expected: UnionType, rules: ConversionRules): Type | undefined {
  return (
    ownMember(member, expected, rules) ??
    baseMember(member, expected, rules) ??
    absorbingMember(expected.members, member, rules)
  );
}

/** The member of `expected` that `member`'s values are values of as their base, if any. */
function baseMember(member: Type, expected: UnionType, rules: ConversionRules): Type | undefined {
  const literals = member.kind === 'parameter' ? rules.memberUnionOf(member) : member;
  const base = literals === undefined ? undefined : literalsBase(literals);
  return base !== undefined && hasMember(expected, base) ? base : undefined;
}

/**
 * The member of `expected` that is `found`'s own type: one written without a type parameter, else
 * one written with one that takes it, so inference binds a parameter only to what the others
 * don't take (§3.5).
 */
function ownMember(found: Type, expected: UnionType, rules: ConversionRules): Type | undefined {
  const isGeneric = (member: Type) => parametersIn(member).length > 0;
  const isOwn = (member: Type) => rules.exact(member, found);
  return (
    expected.members.find((member) => !isGeneric(member) && isOwn(member)) ??
    expected.members.find((member) => isGeneric(member) && isOwn(member))
  );
}

/**
 * The members of the union `expected` that a value of `found`, no union and of none of its members'
 * own types, converts into: each tried alone, leaving nothing behind, so what one binds never
 * decides another, and the one it goes into converted again for good.
 */
function membersConverting(found: Type, expected: UnionType, rules: Matching): readonly Type[] {
  return expected.members.filter((member) =>
    // A recursive member stands for what it unfolds to (§3.17), which is what converts.
    rules.trial(() => convertedInto(found, unfolded(member), rules) !== undefined),
  );
}

/**
 * Whether a value of `found` would go into a union `expected` as several of its members, each by
 * a conversion: a fit refused as ambiguous rather than as a mismatch.
 */
function intoSeveral(found: Type, expected: Type, fitting: Fitting): boolean {
  if (expected.kind !== 'union' || found.kind === 'union') {
    return false;
  }
  const rules = matchingWith({
    ...fitting,
    exact: (target, source) => isAssignable(source, target, fitting),
    same: (target, source) => isAssignableInvariantly(source, target, fitting),
  });
  return (
    ownMember(found, expected, rules) === undefined &&
    membersConverting(found, expected, rules).length > 1
  );
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
 * async, a one-element tuple and its element, a nominal struct's value as its shape, or its parts
 * converted (§3.5).
 */
export function reshapes(fit: Fit): boolean {
  return reshapingKinds.has(fit.conversion.kind);
}

const reshapingKinds: ReadonlySet<Fit['conversion']['kind']> = new Set([
  'async',
  'tupled',
  'untupled',
  'shape',
  'parts',
]);

/**
 * `source`, a function giving no future, made async where `target`, a function of its parameters
 * giving a future of its result, is expected: calling it gives a future already resolved (§3.14),
 * of `target`'s kind. Undefined where it doesn't fit so.
 */
function asyncFitOf(
  source: Type,
  target: Type,
  rules: Pick<ConversionRules, 'exact' | 'futureOf' | 'awaitedOf'>,
): FunctionType | undefined {
  const mode = target.kind === 'function' ? rules.awaitedOf(target.result)?.mode : undefined;
  const made =
    source.kind === 'function' && mode !== undefined ? madeAsync(source, rules, mode) : undefined;
  return made !== undefined && rules.exact(target, made) ? made : undefined;
}

/**
 * Whether `found`, a constraint a type meets, stands for `expected` as its trait's variance says
 * (§3.10): `Source<Int>` for `Source<Int?>` where `Source` only gives what it is given for.
 */
export function constraintFits(found: Constraint, expected: Constraint, fitting: Fitting): boolean {
  const rules = matchingWith({
    ...fitting,
    exact: (target, source) => isAssignable(source, target, fitting),
    same: (target, source) => isAssignableInvariantly(source, target, fitting),
  });
  return (
    sameConstraint(found, expected) ||
    (found.trait === expected.trait &&
      argumentsFitAs(fitting.varianceOf(found.trait), found.arguments, expected.arguments, rules))
  );
}

/** Whether `fit` converts nothing: the value has the expected type. */
export function isExact(fit: Fit): boolean {
  return fit.conversion.kind === 'none' && fit.into === undefined;
}

/** The diagnostic for a value of `found` at `at` that doesn't fit `expected`. */
export function misfitOf(
  fitting: Fitting,
  at: AnchoredSpan,
  found: Type,
  expected: Type,
): Diagnostic<AnchoredSpan> {
  return intoSeveral(found, expected, fitting)
    ? checkerDiagnostics.severalConversions(at, typeText(found), typeText(expected))
    : checkerDiagnostics.typeMismatch(at, typeText(expected), typeText(found));
}
