/**
 * How a given type relates to a declared one as it is, while inferring (§3.5): what fitting asks
 * at each place a value may fit without a conversion (types/fitting/fit/, `exact`), so the
 * conversions around it stay fitting's own and compose as they do for any value.
 *
 * - A variable expected is bounded below by what is found, one found is bounded above by what is
 *   expected, and two related hand each other their bounds (infer.ts, bounds.ts).
 * - A union found holding variables puts each member where the expected type is: into a union,
 *   what its members without variables don't take (`fromUnionHolding`), so `T?` expected to be an
 *   `Int?` bounds `T` by `Int`. Into a union holding variables, what its other
 *   members don't take goes to the member with them (`intoUnionHolding`); a value holding variables
 *   into a union without goes to the one member that takes it (`intoOneMember`).
 * - A type built of others relates part by part as its variance says (fit/parts.ts), each part
 *   fitted as any value is, the error type and `Never` bounding nothing, `Never` noted where it is
 *   given as a variable. An `any` type, and a function type ending in a pack, which takes the
 *   parameters past its fixed ones as they are, relate only as the very same type (equal.ts).
 * - A type standing for what its parameters make it tells nothing while one is to be found.
 */

import type { Fitting } from '../fitting/fit/index.ts';
import { fitsByParts, type PartsRelation } from '../fitting/fit/parts.ts';
import { isAssignable, sameType } from '../identity/identity.ts';
import type { UnfoldingPairs } from '../identity/unfolding-pairs.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { ParameterKey, Type, UnionType } from '../type/index.ts';
import { isPrimitive } from '../type/primitives.ts';
import { unionOfNormalized } from '../unions/unions.ts';
import { givesNothing, isOpaque } from './equal.ts';

/** What relating types asks of the inference it serves. */
export interface Relating {
  readonly fitting: Fitting;
  readonly unfolding: UnfoldingPairs;
  readonly isUnknown: (parameter: ParameterKey) => boolean;
  readonly bindLower: (parameter: ParameterKey, type: Type) => boolean;
  readonly bindUpper: (parameter: ParameterKey, type: Type) => boolean;
  /** Bounds `lower` by `upper`, both variables: each takes the other's bounds (bounds.ts). */
  readonly bindBetween: (lower: ParameterKey, upper: ParameterKey) => boolean;
  /** Whether `declared` and `given` are the very same type, bounding variables equal. */
  readonly equal: (declared: Type, given: Type) => boolean;
  /** Whether a value of `found` fits `expected`, as any value fits, undoing what a failure bound. */
  readonly constrain: (found: Type, expected: Type) => boolean;
  /** Whether `probe` holds, undoing what it bound either way. */
  readonly trial: (probe: () => boolean) => boolean;
  /** Notes the variables `declared` mentions, the error type given where it stands. */
  readonly meetError: (declared: Type) => void;
  readonly noteNever: (parameter: ParameterKey) => void;
}

/** Whether a value of `found` fits `expected` as it is, as the banner says. */
export function relatedAsIs(expected: Type, found: Type, relating: Relating): boolean {
  if (found.kind === 'error') {
    relating.meetError(expected);
    return true;
  }
  if (expected.kind === 'error' || givesNothing(expected)) {
    return true;
  }
  const bound = boundVariables(expected, found, relating);
  if (bound !== undefined) {
    return bound;
  }
  const mentionsVariable = (type: Type) => parametersIn(type).some(relating.isUnknown);
  if (!(mentionsVariable(expected) || mentionsVariable(found))) {
    return isAssignable(found, expected);
  }
  if (found.kind === 'union' && mentionsVariable(found)) {
    return expected.kind === 'union'
      ? fromUnionHolding(expected, found, relating)
      : found.members.every((member) => relating.constrain(member, expected));
  }
  if (expected.kind === 'union') {
    return mentionsVariable(expected)
      ? intoUnionHolding(expected, found, relating)
      : intoOneMember(expected, found, relating);
  }
  return relatedByParts(expected, found, relating);
}

/**
 * Bounds the variable either side is, both where both are; undefined where neither is one, for
 * the types to be related otherwise.
 */
function boundVariables(expected: Type, found: Type, relating: Relating): boolean | undefined {
  const expectedVariable = variableOf(expected, relating);
  const foundVariable = variableOf(found, relating);
  if (expectedVariable !== undefined && foundVariable !== undefined) {
    return relating.bindBetween(foundVariable, expectedVariable);
  }
  if (expectedVariable !== undefined) {
    return relating.bindLower(expectedVariable, found);
  }
  return foundVariable === undefined ? undefined : relating.bindUpper(foundVariable, expected);
}

/** The variable `type` is, if it is one of the call's. */
function variableOf(type: Type, relating: Relating): ParameterKey | undefined {
  return type.kind === 'parameter' && relating.isUnknown(type.declaration)
    ? type.declaration
    : undefined;
}

/**
 * A value of `found` into a union holding variables (§2, §3.5): a union's members written without
 * a variable take theirs among `found`'s, and its one member with variables takes what is left, as
 * one union: `Contact?` given for a `T?` gives `T` a `Contact`. Several members with variables take
 * what is left member by member, in the order written. A value of no union is fitting's to put into
 * a member, those without variables first.
 */
function intoUnionHolding(expected: UnionType, found: Type, relating: Relating): boolean {
  if (found.kind !== 'union') {
    return false;
  }
  const holding = (member: Type) => parametersIn(member).some(relating.isUnknown);
  const open = expected.members.filter(holding);
  const fixed = expected.members.filter((member) => !holding(member));
  const left = found.members.filter((member) => !fixed.some((each) => sameType(each, member)));
  if (left.length === 0) {
    return true;
  }
  const [only] = open;
  if (open.length === 1 && only !== undefined) {
    return relating.constrain(unionOfNormalized(left), only);
  }
  return (
    open.length === left.length &&
    open.every((member, index) => {
      const other = left[index];
      return other !== undefined && relating.constrain(other, member);
    })
  );
}

/**
 * A union holding variables into a union (§3.5), as a call's result `T?` goes into an expected
 * `Int?`: its members without variables go where they go, taking their own members of `expected`,
 * and its members with variables go into what is left, so `T` is bounded by `Int`, never `Int?`.
 */
function fromUnionHolding(expected: UnionType, found: UnionType, relating: Relating): boolean {
  const holding = (member: Type) => parametersIn(member).some(relating.isUnknown);
  const fixed = found.members.filter((member) => !holding(member));
  if (!fixed.every((member) => relating.constrain(member, expected))) {
    return false;
  }
  const left = expected.members.filter((member) => !fixed.some((each) => sameType(each, member)));
  const rest = left.length === 0 ? expected : unionOfNormalized(left);
  return found.members.filter(holding).every((member) => relating.constrain(member, rest));
}

/**
 * A value of `found`, holding variables, into a union without any (§3.5): bounded by the one member
 * it can go into; going into several, it gives nothing, as an expected union naming two
 * instantiations of the result's type does (`Box<Int> | Box<String>`).
 */
function intoOneMember(expected: UnionType, found: Type, relating: Relating): boolean {
  const taking = expected.members.filter((member) =>
    relating.trial(() => relating.constrain(found, member)),
  );
  const [only] = taking;
  if (taking.length === 1 && only !== undefined) {
    return relating.constrain(found, only);
  }
  return taking.length > 1;
}

/** A type holding variables related part by part, or as the very same type where it must be. */
function relatedByParts(expected: Type, found: Type, relating: Relating): boolean {
  if (found.kind === 'union') {
    return found.members.every((member) => relating.constrain(member, expected));
  }
  if (isOpaque(expected)) {
    return parametersIn(expected).some(relating.isUnknown) || sameType(expected, found);
  }
  if (expected.kind === 'any' || found.kind === 'any' || endsInPack(expected)) {
    return relating.equal(expected, found);
  }
  return fitsByParts(found, expected, partsRelation(relating));
}

/** How a type built of others relates part by part, a part fitted as any value is. */
function partsRelation(relating: Relating): PartsRelation {
  return {
    varianceOf: relating.fitting.varianceOf,
    shapeOf: relating.fitting.shapeOf,
    relating: relating.unfolding,
    same: relating.equal,
    fits: (found, expected) => {
      if (found.kind === 'error') {
        relating.meetError(expected);
        return true;
      }
      if (isPrimitive(found, 'Never')) {
        if (expected.kind === 'parameter' && relating.isUnknown(expected.declaration)) {
          relating.noteNever(expected.declaration);
        }
        return true;
      }
      return relating.constrain(found, expected);
    },
  };
}

/** Whether `type` is a function type ending in a pack. */
function endsInPack(type: Type): boolean {
  return type.kind === 'function' && type.pack !== undefined;
}
