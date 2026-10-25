/**
 * Values leaving an instance as JSON (§9): what a host sees of an outcome. An instance a host
 * starts, `main`'s included, runs through its start wrapper, which encodes the function's outcome
 * by its declared type (docs/arch/boundary.md), so the outcome is already a `Json` value, given to
 * a host as JSON values, as everything a host exchanges is, or as its text. Any other value, such
 * as the outcome of a spawned instance, has no JSON the program wrote, so it is refused.
 */

import type { Definition } from '../../definition/definition.ts';
import {
  isJsonValue,
  type JsonType,
  jsonText,
  jsonTypeIn,
  plainOfJson,
} from '../../definition/json-values.ts';
import type { Value } from '../../definition/values.ts';
import { Refusal } from '../refusal.ts';

/** `value`, a `Json` the program built, as the JavaScript JSON a host works with (bigint integers). */
export function outcomeJson(value: Value, definition: Definition): unknown {
  return plainOfJson(value, encodedShape(value, definition));
}

/** `value`, a `Json` the program built, as the JSON text §9 writes. */
export function outcomeText(value: Value, definition: Definition): string {
  return jsonText(value, encodedShape(value, definition));
}

/** The shape of the `Json` `value` is; a Refusal when it isn't one. */
function encodedShape(value: Value, definition: Definition): JsonType {
  const shape = jsonTypeIn(definition.types);
  if (shape === undefined || !isJsonValue(value, shape)) {
    throw new Refusal(
      'noJsonForm',
      'Only what a start wrapper encoded crosses to the host as JSON.',
    );
  }
  return shape;
}
