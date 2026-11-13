/**
 * What a call through a requirement runs, where the body making it can't name one witness
 * (design.md §5.4).
 *
 * - **On a union, or a computed type an instantiation made known:** each member's witness, or its
 *   own, which the call site applies as one call's (`witnessesOf`).
 * - **Through an `any` value:** code nobody sees, judged by types like a call of an unknown
 *   function value. Its witnesses are checked where a value is put into an `any` instead
 *   (`convertedWitnesses`): code nobody sees may call any of them, with any values of their
 *   parameters' types. Which values a program puts into an `any` is the whole program's to say,
 *   so a call through one never reads it: an edit putting another value in changes only the
 *   function putting it in.
 * - **What a copy puts into an `any`** is read off the checker's fit of it: the value itself,
 *   member by member, where it converts into one; its parts, where it converts part by part or into
 *   a shape (types/fitting/part-pairs.ts); a union's members, where it goes into a union member by
 *   member. A value of a type not known yet, or of another `any`, puts in no witness known here:
 *   the call instantiating a generic checks the witnesses it gives (analysis/calls.ts), and what
 *   went into the other `any` was checked as it went in.
 */

import type { CheckerContext } from '../../contexts/context.ts';
import type { WrittenFit } from '../../surface/checked-body.ts';
import {
  type FunctionCall,
  functionCallsWithin,
  type RequirementCall,
} from '../../surface/resolved-call.ts';
import type { Fit } from '../../types/fitting/fit/index.ts';
import { type PartRules, partPairs } from '../../types/fitting/part-pairs.ts';
import { UnfoldingPairs } from '../../types/identity/unfolding-pairs.ts';
import { isKnown, mentionsError } from '../../types/parts/type-parts.ts';
import { membersOf, type Type } from '../../types/type/index.ts';
import type { FlowFunction, Operation } from '../flow/flow-ir.ts';
import type { Conversion } from './summary.ts';

type DispatchRules = PartRules & Pick<CheckerContext, 'traitObjects'>;

/**
 * The witnesses `call` runs where it is made: on a union, each member's; on a computed type made
 * known, its own. Undefined where they can't be known here: through an `any`, or a type
 * parameter's requirement.
 */
export function witnessesOf(
  rules: DispatchRules,
  call: RequirementCall,
): readonly FunctionCall[] | undefined {
  const { requirement } = call;
  if (requirement.kind === 'constraint') {
    return undefined;
  }
  const members = requirement.kind === 'members' ? membersOf(requirement.on) : [requirement.on];
  return members.every(isKnown)
    ? members.filter(hasWitnesses).flatMap((member) => {
        const witness = rules.traitObjects.memberWitnesses(requirement.through, 0, member)?.[
          requirement.member
        ];
        return witness?.kind === 'function' ? [witness] : [];
      })
    : undefined;
}

/**
 * What a copy of a value of `from` into a value of `into`, converted as `fit` says, puts into an
 * `any`: into a field a key naming several gives, what it would put into any of them.
 */
export function conversionsOf(
  rules: PartRules,
  { from, into, fit }: { readonly from: Type; readonly into: Type; readonly fit: WrittenFit },
): readonly Conversion[] {
  const relating = new UnfoldingPairs();
  const conversions =
    fit === 'intoKeyedField'
      ? membersOf(into).flatMap((field) => anyConversionsBetween(rules, from, field, relating))
      : fitConversions(rules, from, fit, relating);
  return conversions.filter(({ member }) => !mentionsError(member));
}

/**
 * The witnesses `conversion` puts into its `any`, each with the calls it makes of its own
 * witnesses; undefined where some can't be named here, a type parameter's or a computed type's,
 * for each call instantiating the function to name. A value of another `any` puts in none.
 */
export function witnessesPutIn(
  rules: DispatchRules,
  { to, member }: Conversion,
): readonly FunctionCall[] | undefined {
  if (member.kind === 'any') {
    return [];
  }
  const calls = to.constraints.flatMap((_, index) => [
    ...(rules.traitObjects.memberWitnesses(to, index, member) ?? []),
  ]);
  const named =
    calls.every((call) => call.kind === 'function') && (calls.length > 0 || isKnown(member));
  return named ? calls.flatMap(functionCallsWithin) : undefined;
}

/** The witnesses `flow`'s copies put into an `any`, its nested functions' among them. */
export function witnessesConvertedIn(
  rules: DispatchRules,
  flow: FlowFunction,
): readonly FunctionCall[] {
  return flow.blocks.flatMap(({ operations }) =>
    operations.flatMap((operation): readonly FunctionCall[] => {
      if (operation.op === 'make' && operation.made.kind === 'closure') {
        return witnessesConvertedIn(rules, operation.made.function);
      }
      const copied = operation.op === 'copy' ? copiedTypes(flow, operation) : undefined;
      return copied === undefined
        ? []
        : conversionsOf(rules, copied).flatMap(
            (conversion) => witnessesPutIn(rules, conversion) ?? [],
          );
    }),
  );
}

/** A copy's types and fit, where checking fitted it and both its values' types are known. */
export function copiedTypes(
  flow: FlowFunction,
  { from, into, fit }: Extract<Operation, { op: 'copy' }>,
): { readonly from: Type; readonly into: Type; readonly fit: WrittenFit } | undefined {
  const fromType = flow.values[from]?.type;
  const intoType = flow.values[into]?.type;
  return fit === undefined || fromType === undefined || intoType === undefined
    ? undefined
    : { from: fromType, into: intoType, fit };
}

/**
 * Whether values of `type` carry witnesses the program gives: its types known, and no mistake in
 * it, which checking reported and which meets no trait.
 */
function hasWitnesses(type: Type): boolean {
  return isKnown(type) && !mentionsError(type);
}

/** The values a value of `from` fitted as `fit` says puts into an `any`. */
function fitConversions(
  rules: PartRules,
  from: Type,
  { conversion, into }: Fit,
  relating: UnfoldingPairs,
): readonly Conversion[] {
  if (conversion.kind === 'any') {
    return membersOf(from).map((member) => ({ to: conversion.to, member }));
  }
  if (conversion.kind === 'parts' || conversion.kind === 'shape') {
    return partPairs(rules, from, conversion.to).flatMap(([part, target]) =>
      anyConversionsBetween(rules, part, target, relating),
    );
  }
  return conversion.kind === 'none' && into !== undefined && into.member === undefined
    ? membersOf(from).flatMap((member) =>
        anyConversionsBetween(rules, member, into.union, relating),
      )
    : [];
}

/**
 * The values a value of `from` fitted to `to` puts into an `any`, as the checker fits them
 * (`fitOf`). A pair met again while it is read puts nothing new in.
 */
function anyConversionsBetween(
  rules: PartRules,
  from: Type,
  to: Type,
  relating: UnfoldingPairs,
): readonly Conversion[] {
  return relating.relate(from, to, [], (value, place) => {
    const fit = rules.fitOf(value, place);
    return fit === undefined ? [] : fitConversions(rules, value, fit, relating);
  });
}
