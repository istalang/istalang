/**
 * Values compile time computes (§2, §3): what the checker hands lowering for a top-level constant
 * or a duration literal, so lowering only maps types to table indexes. With check.ts, this is the
 * checker's surface for later phases; it holds value constructors, so it can't sit in check.ts,
 * which the checker's own modules import.
 */

import { type NominalType, type StructValueType, sameType } from './types/type.ts';

/**
 * A primitive (`unit` is `null`), a struct of a struct type with its fields in declaration order,
 * a tuple, an array, or a map with its entries in order and no two keys equal.
 */
export type ConstantForm =
  | { readonly kind: 'primitive'; readonly value: null | boolean | string | bigint | number }
  | {
      readonly kind: 'struct';
      readonly type: StructValueType;
      readonly fields: readonly ConstantForm[];
    }
  | { readonly kind: 'tuple'; readonly elements: readonly ConstantForm[] }
  | { readonly kind: 'array'; readonly elements: readonly ConstantForm[] }
  | { readonly kind: 'map'; readonly entries: readonly (readonly [ConstantForm, ConstantForm])[] };

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

/** Whether two forms are equal values by the built-in `==` (§3.9), map keys included. */
export function sameForm(first: ConstantForm, second: ConstantForm): boolean {
  if (first.kind === 'primitive' || second.kind === 'primitive') {
    return (
      first.kind === 'primitive' && second.kind === 'primitive' && first.value === second.value
    );
  }
  if (first.kind === 'map' && second.kind === 'map') {
    return (
      first.entries.length === second.entries.length &&
      first.entries.every(([key, value]) => {
        const other = second.entries.find(([candidate]) => sameForm(candidate, key));
        return other !== undefined && sameForm(other[1], value);
      })
    );
  }
  const [left, right] = [partsOf(first) ?? [], partsOf(second) ?? []];
  return (
    first.kind === second.kind &&
    sameHead(first, second) &&
    left.length === right.length &&
    left.every((part, index) => {
      const other = right[index];
      return other !== undefined && sameForm(part, other);
    })
  );
}

/** Whether two forms of one kind agree on what isn't a part: a struct's type. */
function sameHead(first: ConstantForm, second: ConstantForm): boolean {
  return first.kind === 'struct' && second.kind === 'struct'
    ? sameType(first.type, second.type)
    : true;
}

function partsOf(form: ConstantForm): readonly ConstantForm[] | undefined {
  switch (form.kind) {
    case 'struct':
      return form.fields;
    case 'tuple':
    case 'array':
      return form.elements;
    case 'map':
      return form.entries.flat();
    default:
      return undefined;
  }
}
