/**
 * Fitting part by part (§3.5): a value whose type is built of other types fits where an instance of
 * the same construct is expected when each part fits as the construct's variance says, so
 * conversions compose inside types. Its own rule, apart from fitting's entry (index.ts), which
 * hands it the match it belongs to, so a part is fitted as any value is.
 */

import { sameItems } from '../../../../../foundation/structures/equality.ts';
import type { UnfoldingPairs } from '../../identity/unfolding-pairs.ts';
import type {
  AnonymousStructType,
  FieldMember,
  FunctionType,
  NominalType,
  ParameterSlot,
  Type,
} from '../../type/index.ts';
import type { Variance } from '../../variance/lattice.ts';
import type { Fitting } from './index.ts';

/** What relating two types part by part reads: the match it belongs to. */
export interface PartsRelation extends Pick<Fitting, 'varianceOf' | 'shapeOf'> {
  /** The pairs being related, so a recursive type's parts are related once. */
  readonly relating: UnfoldingPairs;
  readonly exact: (expected: Type, found: Type) => boolean;
  /** Whether a value of `found` fits where `expected` is, as the match fits any value. */
  readonly fits: (found: Type, expected: Type) => boolean;
}

/**
 * Whether `found` fits `expected` part by part (§3.5): instantiations of one declaration whose
 * arguments fit as its variance says, tuples of as many elements, a shape (or a nominal struct, as
 * its shape) into a shape of the same fields, or a function into a function type of its shape,
 * taking what it takes and giving what it gives, made async where it is expected to be. A
 * recursive type is related as it unfolds, a pair met again holding, so relating one ends.
 */
export function fitsByParts(found: Type, expected: Type, relation: PartsRelation): boolean {
  return relation.relating.relate(found, expected, true, (value, place) => {
    if (value.kind === 'nominal' && place.kind === 'nominal') {
      return argumentsFit(value, place, relation);
    }
    if (value.kind === 'tuple' && place.kind === 'tuple') {
      return sameItems(relation.fits)(value.elements, place.elements);
    }
    if (place.kind === 'anonymous') {
      const shape = value.kind === 'anonymous' ? value : relation.shapeOf(value);
      return shape !== undefined && fieldsFit(shape, place, relation);
    }
    return (
      value.kind === 'function' &&
      place.kind === 'function' &&
      functionFitsByParts(value, place, relation)
    );
  });
}

/** Whether a value of `found` fits `expected`, both of one declaration, argument by argument. */
function argumentsFit(found: NominalType, expected: NominalType, relation: PartsRelation): boolean {
  const { declaration } = found.entity;
  return (
    declaration === expected.entity.declaration &&
    argumentsFitAs(relation.varianceOf(declaration), found.arguments, expected.arguments, relation)
  );
}

/**
 * Whether the type arguments `found` fit `expected`, given to one declaration whose parameters have
 * `variances`, each as its variance says.
 */
export function argumentsFitAs(
  variances: readonly Variance[],
  found: readonly Type[],
  expected: readonly Type[],
  relation: PartsRelation,
): boolean {
  return (
    found.length === expected.length &&
    found.every((argument, index) => {
      const other = expected[index];
      return (
        other !== undefined && fitsAs(variances[index] ?? 'invariant', argument, other, relation)
      );
    })
  );
}

/** Whether `found` fits `expected` where a parameter of `variance` stands (§3.5). */
function fitsAs(variance: Variance, found: Type, expected: Type, relation: PartsRelation): boolean {
  switch (variance) {
    case 'covariant':
      return relation.fits(found, expected);
    case 'contravariant':
      return relation.fits(expected, found);
    default:
      return relation.exact(expected, found);
  }
}

/** Whether a shape's fields fit another's of the same names, field by field, in name order. */
function fieldsFit(
  found: AnonymousStructType,
  expected: AnonymousStructType,
  relation: PartsRelation,
): boolean {
  return sameItems<FieldMember>(
    (field, other) => field.name === other.name && relation.fits(field.type, other.type),
  )(found.fields, expected.fields);
}

/**
 * Whether a function of type `found` fits where `expected` is, part by part: sendable where it is
 * expected to be, async alike or made async, taking what `expected` takes, a `&` exactly, and
 * giving what it gives (§3.14). A function ending in a pack fits only as it is.
 */
function functionFitsByParts(
  found: FunctionType,
  expected: FunctionType,
  relation: PartsRelation,
): boolean {
  const { fits, exact } = relation;
  return (
    (found.isAsync === expected.isAsync || !found.isAsync) &&
    (found.isSendable || !expected.isSendable) &&
    found.pack === undefined &&
    expected.pack === undefined &&
    sameItems<ParameterSlot>(
      (taken, given) =>
        taken.reference === given.reference &&
        (taken.reference ? exact(taken.type, given.type) : fits(given.type, taken.type)),
    )(found.parameters, expected.parameters) &&
    fits(found.result, expected.result)
  );
}
