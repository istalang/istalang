/**
 * The `json` module's natives (json.ista): JSON text in and out, and the leaf steps of the compiled
 * codecs that need JavaScript's view of a number or the host's own JSON. Everything that walks a
 * typed value is compiled code (docs/arch/boundary.md), so nothing here runs program code.
 *
 * - A float JSON can't hold, NaN or an infinity, is written as `null`, as `JSON.stringify` does.
 * - Two keys of an object that write the same text keep the later value; whoever writes the
 *   object sorts its keys (definition/json-values.ts).
 * - A host type's value is whatever JSON its host gave it, handed back unchanged (§9). A host type
 *   a `dispose` makes disposable keeps that JSON in a resource, made as the value arrives (§7).
 * - Text that isn't JSON is an `Err` saying why, never a panic: it comes from outside. The json
 *   module makes it the `Error` every failed read gives.
 */

import { mapOf } from '../../definition/equality.ts';
import { namedKey, nativeKey, parameterKey, primitiveKey } from '../../definition/extern-key.ts';
import {
  JsonError,
  jsonOfPlain,
  jsonOfText,
  jsonText,
  jsonTypeOf,
  plainOfJson,
} from '../../definition/json-values.ts';
import { isResourceType } from '../../definition/types.ts';
import { elementsOf, type Value } from '../../definition/values.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives, WithResources } from '../../runtime/natives.ts';
import { Refusal } from '../../runtime/refusal.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { fieldOf, float, given, resultErr, resultOk, text } from '../native-values.ts';
import { jsonName } from '../stdlib-loader.ts';

/** The JSON a host gave a value of one of its types: the value itself, or its resource's (§7). */
function hostPayloadOf(value: Value, context: NativeContext & WithResources): unknown {
  if (typeof value === 'object' && value !== null && value.kind === 'extern') {
    return value.payload;
  }
  if (typeof value === 'object' && value !== null && value.kind === 'handle') {
    return context.resources.payloadOf(value);
  }
  unreachable('Expected a value of a host type.');
}

const json = namedKey(qualifiedName(wellKnown.json));
const string = primitiveKey('string');

export const jsonNatives: Natives<NativeContext & WithResources> = {
  [nativeKey(jsonName, '_write', json)]: ([value], context) =>
    jsonText(given(value), jsonTypeOf(context.types)),
  [nativeKey(jsonName, '_read', string)]: ([source], context) => {
    try {
      return resultOk(context, jsonOfText(text(source), jsonTypeOf(context.types)));
    } catch (error) {
      if (!(error instanceof JsonError)) {
        throw error;
      }
      return resultErr(context, `Not JSON: ${error.message}`);
    }
  },
  [nativeKey(jsonName, '_refuse', string)]: ([message]) => {
    throw new Refusal('unfitJson', text(message));
  },
  [nativeKey(jsonName, 'toJson', primitiveKey('float'))]: ([value], context) =>
    jsonOfPlain(Number.isFinite(float(value)) ? float(value) : null, jsonTypeOf(context.types)),
  [nativeKey(
    jsonName,
    '_object',
    namedKey('prelude.Array', { kind: 'tuple', elements: [string, json] }),
  )]: ([fields], context) => {
    const shape = jsonTypeOf(context.types);
    const entries = elementsOf(fields).map((pair): [string, Value] => [
      text(fieldOf(pair, 0)),
      fieldOf(pair, 1),
    ]);
    return {
      kind: 'variant',
      type: shape.type,
      variant: shape.variants.Object,
      fields: [mapOf(entries)],
    };
  },
  [nativeKey(jsonName, '_encodeHandle', parameterKey('T'))]: ([value], context) =>
    jsonOfPlain(hostPayloadOf(given(value), context), jsonTypeOf(context.types)),
  [nativeKey(jsonName, '_decodeHandle', json, string)]: ([value], context) => {
    const type = context.typeArguments[0] ?? unreachable(`${context.name} reads no host type.`);
    const payload = plainOfJson(given(value), jsonTypeOf(context.types));
    return resultOk(
      context,
      isResourceType(context.types, type)
        ? context.resources.create(type, payload)
        : { kind: 'extern', type, payload },
    );
  },
};
