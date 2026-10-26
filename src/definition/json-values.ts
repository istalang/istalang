/**
 * JSON as values of the json module's `Json` enum (spec §9), and the two forms JSON takes outside
 * an instance: text, and the JavaScript values a host works with. The compiled codecs turn typed
 * values into `Json` and back (docs/arch/boundary.md); this module only moves `Json` across, for
 * the json module's natives and the runtime's host boundary alike.
 *
 * - Text is written as JavaScript's `JSON.stringify` writes it, except that an integer keeps every
 *   digit at any size and an object's entries are sorted by key, in UTF-16 order as JavaScript
 *   sorts strings: a `Json` object is a map, whose order is no part of its value, so equal values
 *   always give the same text (§9). Text is read with
 *   integers kept exact (lossless-json); a key given twice with different values is refused rather
 *   than resolved by position, since the two readers of such text could disagree.
 * - A host sees what `JSON.parse` of the text would give it, except that every integer is a
 *   `bigint`, so none loses digits and a host can tell an `int` from a `float`. Coming back, a
 *   bigint or a whole number is an `Integer`, any other number a `Number`, so a host need not say
 *   which it means.
 * - `Json` nests no deeper than a persisted value may (`maximumDepth`), checked before either
 *   form is walked, so deep input is refused instead of overflowing the host's stack.
 */

import { qualifiedName, wellKnown } from '../language/well-known.ts';
import { memo } from '../structures/memo.ts';
import { unreachable } from '../structures/unreachable.ts';
import { compareCodeUnits, decodeJson } from './codec.ts';
import { mapOf } from './equality.ts';
import type { TypeId } from './operands.ts';
import type { TypeDefinition } from './types.ts';
import { childValues, isComposite, maximumDepth, type Value } from './values.ts';

/** The type entry the program's `Json` has, and the index of each of its variants. */
export interface JsonType {
  readonly type: TypeId;
  readonly variants: Readonly<Record<JsonVariant, number>>;
}

const jsonVariants = ['Null', 'Bool', 'Integer', 'Number', 'Text', 'List', 'Object'] as const;
type JsonVariant = (typeof jsonVariants)[number];

/** A JSON string, escapes included, and what isn't a bracket: what nesting depth skips. */
const jsonStrings = /"(?:[^"\\]|\\.)*"/gu;
const notBrackets = /[^[\]{}]/gu;

/** The qualified name the json module's `Json` has in a Definition. */
export const jsonTypeName = qualifiedName(wellKnown.json);

const jsonTypes = new WeakMap<readonly TypeDefinition[], JsonType | undefined>();

/** Where `types` holds `Json`, looked up once per table; undefined for a program without it. */
export function jsonTypeIn(types: readonly TypeDefinition[]): JsonType | undefined {
  return memo(jsonTypes, types, () => findJsonType(types));
}

/** Where `types` holds `Json`, which code that handles `Json` values knows it does. */
export function jsonTypeOf(types: readonly TypeDefinition[]): JsonType {
  const shape = jsonTypeIn(types);
  if (shape === undefined) {
    unreachable('A Json value reached a program without the Json type.');
  }
  return shape;
}

function findJsonType(types: readonly TypeDefinition[]): JsonType | undefined {
  const index = types.findIndex(
    (candidate) => candidate.kind === 'enum' && candidate.name === jsonTypeName,
  );
  const entry = types[index];
  if (entry?.kind !== 'enum') {
    return undefined;
  }
  const variants = Object.fromEntries(
    jsonVariants.map((name) => [name, entry.variants.findIndex((each) => each.name === name)]),
  ) as Record<JsonVariant, number>;
  return { type: index, variants };
}

/** Why JSON couldn't be read or written. */
export class JsonError extends Error {
  override readonly name = 'JsonError';
}

/** `json` as JSON text. */
export function jsonText(json: Value, shape: JsonType): string {
  return written(json, shape, 0);
}

/** The `Json` value JSON text holds; a JsonError for text that isn't JSON or nests too deeply. */
export function jsonOfText(text: string, shape: JsonType): Value {
  if (textDepth(text) > maximumDepth) {
    throw new JsonError(`JSON nests deeper than ${maximumDepth} levels.`);
  }
  let parsed: unknown;
  try {
    parsed = decodeJson(text);
  } catch (error) {
    throw new JsonError(error instanceof Error ? error.message : String(error), { cause: error });
  }
  return jsonOfPlain(parsed, shape);
}

/** `json` as the JavaScript value a host works with: `JSON.parse` of its text, integers as bigints. */
export function plainOfJson(json: Value, shape: JsonType, depth = 0): unknown {
  const [variant, field] = partsOf(json, shape, depth);
  switch (variant) {
    case 'Null':
      return null;
    case 'Bool':
    case 'Integer':
    case 'Text':
      return field;
    case 'Number':
      return typeof field === 'number' && Number.isFinite(field) ? field : null;
    case 'List':
      return listItems(field).map((item) => plainOfJson(item, shape, depth + 1));
    case 'Object':
      return Object.fromEntries(
        objectEntries(field).map(([key, item]) => [key, plainOfJson(item, shape, depth + 1)]),
      );
    default:
      unreachable(`Json has no variant ${variant}.`);
  }
}

/** The `Json` value a JavaScript value holds; a JsonError for one that JSON can't hold. */
export function jsonOfPlain(plain: unknown, shape: JsonType, depth = 0): Value {
  if (depth > maximumDepth) {
    throw new JsonError(`JSON nests deeper than ${maximumDepth} levels.`);
  }
  const variant = (name: JsonVariant, fields: Value[]): Value => ({
    kind: 'variant',
    type: shape.type,
    variant: shape.variants[name],
    fields,
  });
  switch (typeof plain) {
    case 'boolean':
      return variant('Bool', [plain]);
    case 'string':
      return variant('Text', [plain]);
    case 'bigint':
      return variant('Integer', [plain]);
    case 'number':
      if (!Number.isFinite(plain)) {
        throw new JsonError(`JSON can't hold the number ${plain}.`);
      }
      return Number.isInteger(plain)
        ? variant('Integer', [BigInt(plain)])
        : variant('Number', [plain]);
    case 'object':
      if (plain === null) {
        return variant('Null', []);
      }
      if (Array.isArray(plain)) {
        const items = plain.map((item: unknown) => jsonOfPlain(item, shape, depth + 1));
        return variant('List', [{ kind: 'array', elements: items }]);
      }
      return variant('Object', [
        mapOf(
          Object.entries(plain).map(([key, item]) => [key, jsonOfPlain(item, shape, depth + 1)]),
        ),
      ]);
    default:
      throw new JsonError(`JSON can't hold a ${typeof plain}.`);
  }
}

/** Whether `value` is a value of the program's `Json`. */
export function isJsonValue(
  value: Value,
  shape: JsonType,
): value is Extract<Value, { readonly kind: 'variant' }> {
  return (
    value !== null && isComposite(value) && value.kind === 'variant' && value.type === shape.type
  );
}

/** The variant `json` is, and its one field: what walking it reads at each level. */
function partsOf(
  json: Value,
  shape: JsonType,
  depth: number,
): readonly [JsonVariant | undefined, Value | undefined] {
  if (depth > maximumDepth) {
    throw new JsonError(`JSON nests deeper than ${maximumDepth} levels.`);
  }
  if (!isJsonValue(json, shape)) {
    unreachable('Expected a Json value.');
  }
  return [jsonVariants[json.variant], childValues(json)[0]];
}

function written(json: Value, shape: JsonType, depth: number): string {
  const [variant, field] = partsOf(json, shape, depth);
  switch (variant) {
    case 'Null':
      return 'null';
    case 'Bool':
    case 'Integer':
      return String(field);
    case 'Number':
      return typeof field === 'number' && Number.isFinite(field) ? JSON.stringify(field) : 'null';
    case 'Text':
      return JSON.stringify(field);
    case 'List':
      return `[${listItems(field)
        .map((item) => written(item, shape, depth + 1))
        .join(',')}]`;
    case 'Object':
      return `{${objectEntries(field)
        .map(([key, item]) => `${JSON.stringify(key)}:${written(item, shape, depth + 1)}`)
        .join(',')}}`;
    default:
      unreachable(`Json has no variant ${variant}.`);
  }
}

function listItems(field: Value | undefined): readonly Value[] {
  if (field === undefined || field === null || !isComposite(field) || field.kind !== 'array') {
    unreachable('Expected the items of a Json list.');
  }
  return field.elements;
}

function objectEntries(field: Value | undefined): readonly (readonly [string, Value])[] {
  if (field === undefined || field === null || !isComposite(field) || field.kind !== 'map') {
    unreachable('Expected the fields of a Json object.');
  }
  return field.entries
    .map(([key, item]): [string, Value] => [String(key), item])
    .sort(([left], [right]) => compareCodeUnits(left, right));
}

/** How deeply JSON text nests, counting brackets outside strings, without parsing it. */
function textDepth(text: string): number {
  let depth = 0;
  let deepest = 0;
  for (const bracket of text.replace(jsonStrings, '').replace(notBrackets, '')) {
    depth += bracket === '[' || bracket === '{' ? 1 : -1;
    deepest = Math.max(deepest, depth);
  }
  return deepest;
}
