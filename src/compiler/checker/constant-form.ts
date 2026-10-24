/**
 * Values compile time computes (§2, §3): what the checker hands lowering for a top-level constant
 * or a duration literal, so lowering only maps types to table indexes. With check.ts, this is the
 * checker's surface for later phases; it holds value constructors, so it can't sit in check.ts,
 * which the checker's own modules import.
 */

import type { NominalType, StructValueType } from './types/type.ts';

/**
 * A primitive (`unit` is `null`), a struct of a struct type with its fields in declaration order,
 * or a tuple.
 */
export type ConstantForm =
  | { readonly kind: 'primitive'; readonly value: null | boolean | string | bigint | number }
  | {
      readonly kind: 'struct';
      readonly type: StructValueType;
      readonly fields: readonly ConstantForm[];
    }
  | { readonly kind: 'tuple'; readonly elements: readonly ConstantForm[] };

/** What a duration literal is (§2): a `time.Duration`, whose one field is its milliseconds. */
export function durationForm(type: NominalType, milliseconds: bigint): ConstantForm {
  return { kind: 'struct', type, fields: [{ kind: 'primitive', value: milliseconds }] };
}

/** The part of `form` at `path`, field and element positions outermost first (§3.15). */
export function formAt(form: ConstantForm, path: readonly number[]): ConstantForm | undefined {
  const [position, ...rest] = path;
  if (position === undefined) {
    return form;
  }
  const part = partsOf(form)?.[position];
  return part === undefined ? undefined : formAt(part, rest);
}

function partsOf(form: ConstantForm): readonly ConstantForm[] | undefined {
  switch (form.kind) {
    case 'struct':
      return form.fields;
    case 'tuple':
      return form.elements;
    default:
      return undefined;
  }
}
