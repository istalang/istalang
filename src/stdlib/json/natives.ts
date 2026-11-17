/**
 * The `json` module's natives (json.ista): JSON text in and out, and the leaf steps of the compiled
 * codecs that need JavaScript's view of a number or the host's own JSON. Everything that walks a
 * typed value is compiled code (docs/arch/boundary.md), so nothing here runs program code.
 *
 * - `Json` is a union of the language's own values (json.ista), so building one is compiled code;
 *   writing it is definition/values/json-values.ts's, which writes a float JSON can't hold, NaN or
 *   an infinity, as `null`, as `JSON.stringify` does, and sorts an object's keys.
 * - A host type's value is whatever JSON its host gave it, handed back unchanged (§9). A host type
 *   a `dispose` makes disposable keeps that JSON in a resource, made as the value arrives (§7).
 * - Text that isn't JSON is an `Err` saying why, never a panic: it comes from outside. The json
 *   module makes it the `Error` every failed read gives.
 * - What `json.encode` wrote a value as is the instance's to keep (`encodings`), by the type it was
 *   written as: the extern's one type argument.
 */

import { type NativeKeys, parameterKey } from '../../definition/extern-key.ts';
import type { TypeReference } from '../../definition/tables/types.ts';
import { isResourceType } from '../../definition/tables/types.ts';
import { namedType } from '../../definition/values/declared-values.ts';
import {
  JsonError,
  jsonOfPlain,
  jsonOfText,
  jsonText,
  jsonTypeOf,
  plainOfJson,
} from '../../definition/values/json-values.ts';
import { externValue, handleTarget, type Value } from '../../definition/values/values.ts';
import { codecHelpers } from '../../foundation/language/well-known/codecs.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type {
  NativeContext,
  Natives,
  WithEncodings,
  WithResources,
} from '../../runtime/natives.ts';
import { Refusal } from '../../runtime/refusal.ts';
import { knownTypeKey } from '../std-module.ts';
import { arrayOf, externPayloadOf, given, text } from '../values/arguments.ts';

/** The JSON a host gave a value of one of its types: the value itself, or its resource's (§7). */
function hostPayloadOf(value: Value, context: NativeContext & WithResources): unknown {
  return handleTarget(value) === undefined
    ? externPayloadOf(value)
    : context.resources.payloadOf(value);
}

/** The type `json.encode`'s extern writes a value as: its value parameter's, `T`. */
function writtenAs(context: NativeContext): TypeReference {
  return context.signature.parameters[0] ?? unreachable(`${context.name} names no type written.`);
}

const json = knownTypeKey(wellKnown.json);

export const jsonNatives = (
  keys: NativeKeys,
): Natives<NativeContext & WithResources & WithEncodings> => ({
  [keys.of('_written', parameterKey('T'))]: ([value], context) => {
    const written = context.encodings.of(given(value), writtenAs(context));
    return arrayOf(written === undefined ? [] : [written]);
  },
  [keys.of('_remember', parameterKey('T'), json)]: ([value, written], context) => {
    context.encodings.remember(given(value), writtenAs(context), given(written));
    return given(written);
  },
  [keys.of('_write', json)]: ([value], context) =>
    jsonText(given(value), jsonTypeOf(context.types)),
  [keys.of('_read', 'String')]: ([source], context) => {
    try {
      const read = jsonOfText(text(source), jsonTypeOf(context.types));
      return { kind: 'tuple', elements: [arrayOf([read]), ''] };
    } catch (error) {
      if (!(error instanceof JsonError)) {
        throw error;
      }
      return { kind: 'tuple', elements: [arrayOf([]), `Not JSON: ${error.message}`] };
    }
  },
  [keys.of('_refuse', 'String')]: ([message]) => {
    throw new Refusal('unfitJson', text(message));
  },
  [keys.of(codecHelpers.encodeHandle, parameterKey('T'))]: ([value], context) =>
    jsonOfPlain(hostPayloadOf(given(value), context), jsonTypeOf(context.types)),
  [keys.of(codecHelpers.decodeHandle, json, 'String')]: ([value], context) => {
    const type = namedType(context.signature.result);
    const payload = plainOfJson(given(value), jsonTypeOf(context.types));
    return isResourceType(context.types, type)
      ? context.resources.create(type, payload)
      : externValue(type, payload);
  },
});
