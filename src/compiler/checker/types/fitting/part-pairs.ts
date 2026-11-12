/**
 * The parts a value converted part by part (§3.5) converts, each paired with the part of the type
 * it goes into. Lowering rebuilds a value by them (lowering/functions/fits/parts.ts), and the
 * lifetime rule reads by them which values go into an `any` (rules/lifetimes/dispatch.ts), so the
 * two never disagree on what goes where.
 *
 * - A union's value converts as the member it holds: each member into the whole type.
 * - A struct's or a shape's value into a shape, field by field, by index in the one name order
 *   every struct lays its fields out in (types/type/field-order.ts).
 * - A function: what the other takes into what it takes, but a `&`, passed on as it is; what it
 *   gives into what the other gives, or into the value of the future the other gives (§3.14).
 * - Tuples element by element; an array's items, a map's values; another nominal type's fields,
 *   every variant's for an enum, and none of a host's, whose JSON a wider type reads alike.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../check.ts';
import { unfolded } from '../type/computed-types.ts';
import { type ResultFit, resultFitOf } from '../type/function-types.ts';
import type { FieldMember, FunctionType, NominalType, Type } from '../type/index.ts';
import { futuresOf, wellKnownArguments } from '../type/well-known.ts';

/** What pairing parts reads of the program. */
export type PartRules = Pick<Checker, 'fitOf' | 'fieldsOf' | 'variantsOf' | 'wellKnownType'>;

/** A part of the value converted, and the part of the type it goes into. */
export type PartPair = readonly [from: Type, to: Type];

/** The pairs of parts converting a value of `given` into `target` part by part converts. */
export function partPairs(rules: PartRules, given: Type, target: Type): readonly PartPair[] {
  const [from, to] = [unfolded(given), unfolded(target)];
  if (from.kind === 'union') {
    return from.members.map((member) => [member, to]);
  }
  if (to.kind === 'anonymous') {
    return paired(rules.fieldsOf(from) ?? [], to.fields);
  }
  if (from.kind === 'function' && to.kind === 'function') {
    return functionPairs(rules, from, to);
  }
  if (from.kind === 'tuple' && to.kind === 'tuple') {
    return zipped(from.elements, to.elements);
  }
  if (from.kind === 'nominal' && to.kind === 'nominal') {
    return collectionPairs(rules, from, to) ?? fieldPairs(rules, from, to);
  }
  return [];
}

/** How the result of a function of type `from` fits where `to` is expected, as the checker found. */
export function resultFitBetween(
  rules: Pick<Checker, 'fitOf' | 'wellKnownType'>,
  from: FunctionType,
  to: FunctionType,
): ResultFit {
  const fits = (given: Type, expected: Type) => rules.fitOf(given, expected) !== undefined;
  return (
    resultFitOf(from.result, to.result, fits, futuresOf(rules)) ??
    unreachable('A function converted part by part gives what fits.')
  );
}

/** A function's parameters paired the other way round, `to`'s into its own, and its results. */
function functionPairs(
  rules: PartRules,
  from: FunctionType,
  to: FunctionType,
): readonly PartPair[] {
  const parameters = from.parameters.flatMap((parameter, index): readonly PartPair[] => {
    const other = to.parameters[index];
    return parameter.reference || other === undefined ? [] : [[other.type, parameter.type]];
  });
  const result = resultFitBetween(rules, from, to);
  return [
    ...parameters,
    result.kind === 'value' ? [from.result, to.result] : [result.value, result.into],
  ];
}

/** An array's items, or a map's values, paired; undefined for any other type. */
function collectionPairs(
  rules: PartRules,
  from: NominalType,
  to: NominalType,
): readonly PartPair[] | undefined {
  const items = wellKnownArguments(rules, wellKnown.array, from);
  if (items !== undefined) {
    return zipped(items.slice(0, 1), to.arguments.slice(0, 1));
  }
  const entries = wellKnownArguments(rules, wellKnown.map, from);
  return entries === undefined ? undefined : zipped(entries.slice(1, 2), to.arguments.slice(1, 2));
}

/** A struct's fields, or every variant's, paired; none for a host's value. */
function fieldPairs(rules: PartRules, from: NominalType, to: NominalType): readonly PartPair[] {
  const fields = (type: NominalType): readonly FieldMember[] =>
    rules.fieldsOf(type) ?? (rules.variantsOf(type) ?? []).flatMap((variant) => variant.fields);
  return paired(fields(from), fields(to));
}

function paired(from: readonly FieldMember[], to: readonly FieldMember[]): readonly PartPair[] {
  return zipped(
    from.map((field) => field.type),
    to.map((field) => field.type),
  );
}

function zipped(from: readonly Type[], to: readonly Type[]): readonly PartPair[] {
  return from.flatMap((part, index): readonly PartPair[] => {
    const other = to[index];
    return other === undefined ? [] : [[part, other]];
  });
}
