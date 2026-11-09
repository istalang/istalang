/**
 * What compile time computes values as (constant-form.ts), and how the walk (index.ts) reports a
 * part of an initializer: computed, refused, or already in error. The implicit conversions compile
 * time makes are here too (§2): taken into or out of a one-element tuple (§3.15), a struct's value
 * rebuilt as its shape, its fields in the shape's name order (§3.1), a value put into a union as
 * one of its members, as a `Json` literal is at any depth, and a value converted part by part
 * (§3.5), each part as the checker fits it, as lowering converts a value (lowering/functions/fits/);
 * the others, a union widened member by member, a value into an `any` type and a function made
 * async or converted, need the runtime, so they are refused. A recursive union's members are
 * flattened into a union holding it (§3.17), so every member a form names is its union's own.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { type ConstantForm, formSemantics } from '../../surface/constant-form.ts';
import type { Fit } from '../../types/fitting/fit/index.ts';
import { unfolded } from '../../types/type/computed-types.ts';
import type { StructValueType, Type } from '../../types/type/index.ts';
import { errorType, tupleElements } from '../../types/type/primitives.ts';
import { arrayElement, wellKnownArguments } from '../../types/type/well-known.ts';

/**
 * How computing a part of an initializer went: computed, refused (`form` or `endless`), or already
 * in error.
 */
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

/** What converting a form reads of the checker. */
type Forming = Pick<CheckerContext, 'fieldsOf' | 'fitOf' | 'wellKnownType'>;

/** `form`, a value of `from`, made to fit as `fit` says; undefined for a fit only the runtime makes. */
export function fittedForm(
  form: ConstantForm,
  from: Type,
  { conversion, into }: Fit,
  checker: Forming,
): ConstantForm | undefined {
  const converted = convertedForm({ form, from }, conversion, checker);
  if (into === undefined || converted === undefined) {
    return converted;
  }
  const { union, member } = into;
  return union.kind === 'union' && member !== undefined
    ? { kind: 'member', union, member, value: converted }
    : undefined;
}

/** A form, and the type it is a value of. */
interface TypedForm {
  readonly form: ConstantForm;
  readonly from: Type;
}

/** `form` converted as `conversion` says; undefined for a conversion only the runtime makes. */
function convertedForm(
  { form, from }: TypedForm,
  conversion: Fit['conversion'],
  checker: Forming,
): ConstantForm | undefined {
  switch (conversion.kind) {
    case 'none':
      return form;
    case 'base':
      // A union of literals' value is its member's literal, which is its base's value already.
      return form.kind === 'member' ? form.value : form;
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
      // A struct and its shape lay out the same fields in one order (field-order.ts).
      return { kind: 'struct', type: conversion.to, fields: form.fields };
    }
    case 'parts':
      return partsForm({ form, from }, conversion.to, checker);
    case 'any':
    case 'async':
      return undefined;
    default: {
      const unhandled: never = conversion;
      return unhandled;
    }
  }
}

/**
 * `form` converted part by part into `to` (§3.5): a union's value as the member it holds, an
 * array's items, a map's values, a tuple's elements and a struct's fields each as the checker fits
 * it; undefined where a part needs the runtime, as a function does.
 */
function partsForm(
  { form, from }: TypedForm,
  to: Type,
  checker: Forming,
): ConstantForm | undefined {
  const value = unfolded(from);
  const target = unfolded(to);
  switch (form.kind) {
    case 'member':
      return fittedPart({ form: form.value, from: form.member }, target, checker);
    case 'array': {
      const item = arrayElement(checker, value) ?? errorType;
      const elements = allFitted(
        form.elements,
        () => item,
        () => arrayElement(checker, target),
        checker,
      );
      return elements === undefined ? undefined : { kind: 'array', elements };
    }
    case 'map': {
      const [, item = errorType] = wellKnownArguments(checker, wellKnown.map, value) ?? [];
      const [, entry] = wellKnownArguments(checker, wellKnown.map, target) ?? [];
      const values = allFitted(
        form.entries.map(([, each]) => each),
        () => item,
        () => entry,
        checker,
      );
      return values === undefined
        ? undefined
        : formSemantics.mapOf(form.entries.map(([key], index) => [key, values[index] ?? key]));
    }
    case 'tuple': {
      const elements = allFitted(
        form.elements,
        (index) => tupleElements(value)?.[index] ?? errorType,
        (index) => tupleElements(target)?.[index],
        checker,
      );
      return elements === undefined ? undefined : { kind: 'tuple', elements };
    }
    case 'struct':
      return target.kind === 'nominal' || target.kind === 'anonymous'
        ? structForm(form, target, checker)
        : undefined;
    default:
      return undefined;
  }
}

/**
 * A struct's form as one of `to`, a struct or a shape of the same fields, field by field in name
 * order (§3.1), so each field's index is its index in `to`.
 */
function structForm(
  form: Extract<ConstantForm, { readonly kind: 'struct' }>,
  to: StructValueType,
  checker: Forming,
): ConstantForm | undefined {
  const own = checker.fieldsOf(form.type) ?? [];
  const targets = checker.fieldsOf(to) ?? [];
  const fields = allFitted(
    form.fields,
    (index) => own[index]?.type ?? errorType,
    (index) => targets[index]?.type,
    checker,
  );
  return fields === undefined ? undefined : { kind: 'struct', type: to, fields };
}

/** Each of `forms`, a value of `fromAt` its position, fitted to `toAt` it; undefined if one can't be. */
function allFitted(
  forms: readonly ConstantForm[],
  fromAt: (index: number) => Type,
  toAt: (index: number) => Type | undefined,
  checker: Forming,
): readonly ConstantForm[] | undefined {
  const fitted: ConstantForm[] = [];
  for (const [index, form] of forms.entries()) {
    const to = toAt(index);
    const part =
      to === undefined ? undefined : fittedPart({ form, from: fromAt(index) }, to, checker);
    if (part === undefined) {
      return undefined;
    }
    fitted.push(part);
  }
  return fitted;
}

/** `form` made to fit `to` as the checker fits a value of its type there. */
function fittedPart(
  { form, from }: TypedForm,
  to: Type,
  checker: Forming,
): ConstantForm | undefined {
  const fit = checker.fitOf(from, to);
  return fit === undefined ? undefined : fittedForm(form, from, fit, checker);
}

/**
 * The items a spread of `form`, an array or a map, gives: its elements, or its entries as tuples.
 */
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
