/**
 * What compile time computes values as (constant-form.ts), and how the walk (index.ts) reports a
 * part of an initializer: computed, refused, or already in error. The implicit conversions compile
 * time makes are here too (§2): taken into or out of a one-element tuple (§3.15), and a struct's
 * value rebuilt as its shape, its fields in the shape's name order (§3.1); the others need the
 * runtime, so they are refused.
 */

import { unreachable } from '../../../../structures/unreachable.ts';
import type { NodeOf } from '../../../syntax/node.ts';
import type { ConstantForm } from '../../constant-form.ts';
import type { CheckerContext } from '../../context.ts';
import type { Fit } from '../../types/fit.ts';

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
  checker: Pick<CheckerContext, 'fieldsOf'>,
): ConstantForm | undefined {
  if (into !== undefined) {
    return undefined;
  }
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
      const names = (checker.fieldsOf(form.type) ?? []).map(({ name }) => name);
      const fields = conversion.to.fields.map(
        ({ name }) =>
          form.fields[names.indexOf(name)] ?? unreachable(`No field '${name}' is computed.`),
      );
      return { kind: 'struct', type: conversion.to, fields };
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
