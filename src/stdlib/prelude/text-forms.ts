/**
 * How the primitives are written as text and read back (§3.10, `Stringable` and `Parsable`): what
 * `toString`, `string(x)` and appending to a string spell, and what `parse` accepts.
 *
 * - A float keeps its `.0` when whole, so `1.0` never reads as the int `1`; NaN and the infinities
 *   are spelled as JavaScript spells them, so `parse` reads every text `toString` writes.
 * - `parse` is strict, since its text comes from outside: decimal digits for an int, at any size,
 *   JavaScript's number syntax for a float, and exactly `true` or `false`. What it refuses is a
 *   `Result` of an `Error` with code `parse`, never a panic (§3.12).
 */

import type { Value } from '../../definition/values.ts';
import type { PrimitiveName } from '../../language/primitives.ts';
import type { Native, NativeContext, Natives } from '../../runtime/natives.ts';
import { parseResult, text } from '../native-values.ts';
import type { NativeKeys } from '../std-module.ts';

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

const readers = {
  int: (source: string) => (intSyntax.test(source) ? BigInt(source) : undefined),
  float: (source: string) => (floatSyntax.test(source) ? Number(source) : floatWords.get(source)),
  bool: (source: string) =>
    source === 'true' || source === 'false' ? source === 'true' : undefined,
} as const satisfies Partial<Record<PrimitiveName, (source: string) => Value | undefined>>;

/** A primitive type `parse` reads. */
export type ParsedPrimitive = keyof typeof readers;

/** What `source` reads back as, a value of `type`; undefined for text that isn't one. */
export function readPrimitive(type: ParsedPrimitive, source: string): Value | undefined {
  return readers[type](source);
}

export const textFormNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  ...Object.fromEntries(
    (['int', 'float', 'bool'] as const).map((type) => [
      keys.of('toString', type),
      ([value]: readonly Value[]) => primitiveText(value),
    ]),
  ),
  ...Object.fromEntries(
    (Object.keys(readers) as ParsedPrimitive[]).map((type) => [
      keys.ofStatic(type, 'parse', 'string'),
      (([source], context) =>
        parseResult(
          context,
          text(source),
          articled(type),
          readPrimitive(type, text(source)),
        )) satisfies Native<NativeContext>,
    ]),
  ),
});

function articled(type: ParsedPrimitive): string {
  return type === 'int' ? 'an int' : `a ${type}`;
}
