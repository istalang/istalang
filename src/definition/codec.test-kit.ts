/**
 * JSON values the codec must return unchanged, and non-canonical texts of a value, for properties
 * that the canonical form ignores key order and whitespace.
 */

import fc from 'fast-check';
import { stringify } from 'lossless-json';

/**
 * JSON whose numbers survive a round trip unchanged: safe integers, floats, and integers beyond
 * the safe range as bigints. A whole double beyond the safe range is excluded on purpose: its
 * text is an integer, which the codec reads back exactly as a bigint.
 */
export const exactJson: fc.Arbitrary<unknown> = fc.letrec<{ json: unknown }>((tie) => ({
  json: fc.oneof(
    { depthSize: 'small', maxDepth: 4 },
    fc.constant(null),
    fc.boolean(),
    fc.string({ unit: 'binary' }),
    fc.integer(),
    fc.double({ min: -1e15, max: 1e15, noNaN: true }).filter((n) => !Object.is(n, -0)),
    fc.bigInt({ min: 2n ** 53n, max: 2n ** 300n }),
    fc.bigInt({ min: -(2n ** 300n), max: -(2n ** 53n) }),
    fc.array(tie('json'), { maxLength: 4 }),
    fc.dictionary(fc.string(), tie('json'), { maxKeys: 4 }),
  ),
})).json;

/** The same JSON value with every object's keys in reverse order. */
export function reverseKeys(json: unknown): unknown {
  if (Array.isArray(json)) {
    return json.map(reverseKeys);
  }
  if (json === null || typeof json !== 'object') {
    return json;
  }
  return Object.fromEntries(
    Object.entries(json)
      .reverse()
      .map(([key, value]) => [key, reverseKeys(value)]),
  );
}

/** A valid JSON text of `json` that is not canonical: keys reversed, indented. */
export function looseText(json: unknown): string {
  return stringify(reverseKeys(json), null, 2) ?? 'null';
}
