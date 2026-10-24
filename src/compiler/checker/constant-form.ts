/**
 * Values compile time computes (§2, §3): what the checker hands lowering for a top-level constant
 * or a duration literal, so lowering only maps types to table indexes. With check.ts, this is the
 * checker's surface for later phases; it holds a value constructor, so it can't sit in check.ts,
 * which the checker's own modules import.
 */

import type { NominalType } from './types/type.ts';

/** A primitive, or a struct of a nominal type with its fields in declaration order. */
export type ConstantForm =
  | { readonly kind: 'primitive'; readonly value: null | boolean | string | bigint | number }
  | {
      readonly kind: 'struct';
      readonly type: NominalType;
      readonly fields: readonly ConstantForm[];
    };

/** What a duration literal is (§2): a `time.Duration`, whose one field is its milliseconds. */
export function durationForm(type: NominalType, milliseconds: bigint): ConstantForm {
  return { kind: 'struct', type, fields: [{ kind: 'primitive', value: milliseconds }] };
}
