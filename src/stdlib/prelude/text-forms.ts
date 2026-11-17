/**
 * How the numbers are written as text and read back (§3.10, `Stringable` and `Parsable`): what
 * `toString`, `String(x)` and appending to a string spell, and what `parse` accepts. A Bool's are
 * the prelude's code.
 *
 * - A float keeps its `.0` when whole, so `1.0` never reads as the int `1`; NaN and the infinities
 *   are spelled as JavaScript spells them, so `parse` reads every text `toString` writes.
 * - `parse` is strict, since its text comes from outside: decimal digits for an int, at any size,
 *   and JavaScript's number syntax for a float. What it refuses is a `Result` of an `Error` with
 *   code `parse`, never a panic (§3.12).
 */

import type { NativeKeys } from '../../definition/extern-key.ts';
import type { Value } from '../../definition/values/values.ts';
import type { PrimitiveName } from '../../foundation/language/primitives.ts';
import type { Native, NativeContext, Natives } from '../../runtime/natives.ts';
import { arrayOf, text } from '../values/arguments.ts';

const wholeDigits = /^-?\d+$/u;
const intSyntax = /^[+-]?\d+$/u;
const floatSyntax = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const floatWords = new Map([
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
]);

/** A primitive's text, as `toString` writes it. */
export function primitiveText(value: Value | undefined): string {
  if (typeof value === 'number') {
    const digits = String(value);
    return wholeDigits.test(digits) ? `${digits}.0` : digits;
  }
  return String(value);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the primitive types' names (§2).
const readers = {
  Int: (source: string) => (intSyntax.test(source) ? BigInt(source) : undefined),
  Float: (source: string) => (floatSyntax.test(source) ? Number(source) : floatWords.get(source)),
} as const satisfies Partial<Record<PrimitiveName, (source: string) => Value | undefined>>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the primitive types' names (§2).

/** A primitive type `parse` reads. */
type ParsedPrimitive = keyof typeof readers;

/** What `source` reads back as, a value of `type`; undefined for text that isn't one. */
export function readPrimitive(type: ParsedPrimitive, source: string): Value | undefined {
  return readers[type](source);
}

export const textFormNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  ...Object.fromEntries(
    (['Int', 'Float'] as const).map((type) => [
      keys.of('toString', type),
      ([value]: readonly Value[]) => primitiveText(value),
    ]),
  ),
  ...Object.fromEntries(
    (Object.keys(readers) as ParsedPrimitive[]).map((type) => [
      keys.ofStatic(type, '_read', 'String'),
      (([source]) => {
        const read = readPrimitive(type, text(source));
        return arrayOf(read === undefined ? [] : [read]);
      }) satisfies Native<NativeContext>,
    ]),
  ),
});
