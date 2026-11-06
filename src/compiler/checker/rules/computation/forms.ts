/**
 * What compile time computes values as (constant-form.ts), and how the walk (index.ts) reports a
 * part of an initializer: computed, refused, or already in error. The implicit conversions compile
 * time makes are here too (§2): taken into or out of a one-element tuple (§3.15), a struct's value
 * rebuilt as its shape, its fields in the shape's name order (§3.1), and a value put into a union
 * as one of its members, as a `Json` literal is at any depth; the others, a union widened member
 * by member and a value into an `any` type, need the runtime, so they are refused. A recursive
 * union's members are flattened into a union holding it (§3.17), so every member a form names is
 * its union's own.
 */

import { unreachable } from '../../../../structures/unreachable.ts';
import type { NodeOf } from '../../../syntax/node.ts';
import type { CheckerContext } from '../../context.ts';
import type { ConstantForm } from '../../surface/constant-form.ts';
import { laidOut, namedValues } from '../../types/field-order.ts';
import type { Fit } from '../../types/fitting/fit.ts';

/** How computing a part of an initializer went: computed, refused (`form` or `endless`), or already in error. */
export type Outcome =
  | { readonly kind: 'computed'; readonly form: ConstantForm }
  | { readonly kind: 'refused'; readonly part: NodeOf<string>; readonly why: 'form' | 'endless' }
  | { readonly kind: 'unknown' };

export const unknown: Outcome = { kind: 'unknown' };

export function computed(form: ConstantForm): Outcome {
  return { kind: 'computed', form };
}

export function refused(part: NodeOf<string>): Outcome {
  return { kind: 'refused', part, why: 'form' };
}

/** `form` made to fit as `fit` says; undefined for a fit only the runtime makes. */
export function fittedForm(
  form: ConstantForm,
  { conversion, into }: Fit,
  checker: Pick<CheckerContext, 'fieldsOf' | 'typeRules'>,
): ConstantForm | undefined {
  const converted = convertedForm(form, conversion, checker);
  if (into === undefined || converted === undefined) {
    return converted;
  }
  const { union, member } = into;
  return union.kind === 'union' && member !== undefined
    ? { kind: 'member', union, member, value: converted }
    : undefined;
}

/** `form` converted as `conversion` says; undefined for a conversion only the runtime makes. */
function convertedForm(
  form: ConstantForm,
  conversion: Fit['conversion'],
  checker: Pick<CheckerContext, 'fieldsOf'>,
): ConstantForm | undefined {
  switch (conversion.kind) {
    case 'none':
    case 'base':
      return form;
    case 'tupled':
      return { kind: 'tuple', elements: [form] };
    case 'untupled': {
      const [element] = form.kind === 'tuple' && form.elements.length === 1 ? form.elements : [];
      return element ?? unreachable('Only a one-element tuple is untupled.');
    }
    case 'shape': {
      if (form.kind !== 'struct') {
        return unreachable("Only a struct's value converts into its shape.");
      }
      const named = namedValues(checker.fieldsOf(form.type) ?? [], form.fields);
      return { kind: 'struct', type: conversion.to, fields: laidOut(conversion.to.fields, named) };
    }
    case 'any':
    case 'async':
      return undefined;
    default: {
      const unhandled: never = conversion;
      return unhandled;
    }
  }
}

/** The items a spread of `form`, an array or a map, gives: its elements, or its entries as tuples. */
export function itemsOf(form: ConstantForm): readonly ConstantForm[] {
  switch (form.kind) {
    case 'array':
      return form.elements;
    case 'map':
      return form.entries.map(([key, value]) => ({ kind: 'tuple', elements: [key, value] }));
    default:
      return [];
  }
}

/** The key and value of a `(key, value)` tuple, a map literal's item. */
export function pairOf(item: ConstantForm): (readonly [ConstantForm, ConstantForm])[] {
  const [key, value] = item.kind === 'tuple' ? item.elements : [];
  return key === undefined || value === undefined ? [] : [[key, value]];
}
