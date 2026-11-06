/**
 * Values leaving an instance as JSON (§9): what a host sees of an outcome. Every instance whose
 * outcome's type has a codec writing it, a started one's (`main`'s included) or a spawned one's,
 * finishes with that outcome encoded too (docs/arch/boundary.md), given to a host as JSON values,
 * as everything a host exchanges is, or as its text. An outcome no codec writes, such as an
 * `Instance`, has no JSON, so it is refused.
 */

import type { Definition } from '../../definition/definition.ts';
import {
  isJsonValue,
  type JsonType,
  jsonText,
  jsonTypeIn,
  plainOfJson,
} from '../../definition/values/json-values.ts';
import type { Value } from '../../definition/values/values.ts';
import type { Finished } from '../instance-state.ts';
import { Refusal } from '../refusal.ts';

/** A finished instance's encoded outcome as the JavaScript JSON a host works with (bigint integers). */
export function outcomeJson(finished: Finished, definition: Definition): unknown {
  const { encoded, shape } = encodedOf(finished, definition);
  return plainOfJson(encoded, shape);
}

/** A finished instance's encoded outcome as the JSON text §9 writes. */
export function outcomeText(finished: Finished, definition: Definition): string {
  const { encoded, shape } = encodedOf(finished, definition);
  return jsonText(encoded, shape);
}

/**
 * The `Json` a finished instance's encoder gave, with its shape; a Refusal when it has none, or
 * when it isn't this program's `Json`, the outcome of another program's instance.
 */
function encodedOf(
  { encoded }: Finished,
  definition: Definition,
): { readonly encoded: Value; readonly shape: JsonType } {
  if (encoded === undefined) {
    throw new Refusal('noJsonForm', 'This outcome has no JSON: no codec writes its type.');
  }
  const shape = jsonTypeIn(definition.types);
  if (shape === undefined || !isJsonValue(encoded, shape)) {
    throw new Refusal('noJsonForm', "This outcome's JSON isn't this program's Json.");
  }
  return { encoded, shape };
}
