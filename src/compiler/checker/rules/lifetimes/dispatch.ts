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
import {
  type FunctionCall,
  functionCallsWithin,
  type RequirementCall,
} from '../../surface/resolved-call.ts';
import type { Fit } from '../../types/fitting/fit/index.ts';
import { type PartRules, partPairs } from '../../types/fitting/part-pairs.ts';
import { UnfoldingPairs } from '../../types/identity/unfolding-pairs.ts';
import { isKnown, mentionsError } from '../../types/parts/type-parts.ts';
import { type AnyType, membersOf, type Type } from '../../types/type/index.ts';
import type { FlowFunction } from '../flow/flow-ir.ts';

/** A value put into an `any`: the `any` type, and the value's own type. */
interface Conversion {
  readonly to: AnyType;
  readonly member: Type;
}

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
 * The witnesses a copy of a value of `from`, converted as `fit` says, puts into an `any`, each with
 * the calls it makes of its own witnesses.
 */
export function convertedWitnesses(
  rules: DispatchRules,
  from: Type,
  fit: Fit,
): readonly FunctionCall[] {
  return fitConversions(rules, from, fit, new UnfoldingPairs())
    .filter(({ member }) => member.kind !== 'any' && hasWitnesses(member))
    .flatMap(({ to, member }) =>
      to.constraints.flatMap((_, index) =>
        (rules.traitObjects.memberWitnesses(to, index, member) ?? []).flatMap(functionCallsWithin),
      ),
    );
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
      const from = operation.op === 'copy' ? flow.values[operation.from]?.type : undefined;
      return operation.op !== 'copy' || operation.fit === undefined || from === undefined
        ? []
        : convertedWitnesses(rules, from, operation.fit);
    }),
  );
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
