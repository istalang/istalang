/**
 * Values leaving an instance as JSON (§9): what a host sees of an outcome. The canonical text comes
 * from the one codec every persisted format uses (definition/codec.ts).
 *
 * - A primitive maps to its JSON form: `int` exactly at any size, `unit` as `null`. A float JSON
 *   can't hold (NaN, ±Infinity) has no JSON form and is refused.
 * - A struct is an object keyed by field name, its type read from the Definition's type table.
 *   Keys come out sorted, as the canonical codec writes every object.
 * - The rest of §9's mapping (annotations, enums, collections, tuples, time) needs what arrives
 *   with the host boundary; until then such a value is refused.
 */

import { encodeJson } from '../../definition/codec.ts';
import type { Definition } from '../../definition/definition.ts';
import type { Value } from '../../definition/values.ts';
import { Refusal } from '../refusal.ts';

/** `value` as the JSON text a host receives; a Refusal for a value without one yet. */
export function outboundJson(value: Value, definition: Definition): string {
  return encodeJson(jsonOf(value, definition));
}

function jsonOf(value: Value, definition: Definition): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Refusal('noJsonForm', `The float ${value} has no JSON form.`);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const type = value.kind === 'struct' ? definition.types[value.type] : undefined;
  if (value.kind !== 'struct' || type?.kind !== 'struct') {
    throw new Refusal('noJsonForm', `A ${value.kind} value can't cross the host boundary yet.`);
  }
  return Object.fromEntries(
    type.fields.map((field, index) => [
      field.name,
      jsonOf(value.fields[index] ?? null, definition),
    ]),
  );
}
