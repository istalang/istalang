/**
 * The order of ints, and of strings by UTF-16 code unit, as the language's `<` and its canonical
 * formats share it: the prelude's comparisons, and the key order of canonical JSON
 * (definition/formats/codec.ts, definition/values/json-values.ts), so one value always has one
 * text.
 */

/** Negative, zero or positive as `left` is before, equal to or after `right`. */
export function compareOrdered<Ordered extends bigint | string>(
  left: Ordered,
  right: Ordered,
): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
