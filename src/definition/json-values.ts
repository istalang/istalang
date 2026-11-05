/**
 * JSON as values of the json module's `Json` (spec §9), the recursive union `None | Bool | Int |
 * Float | String | Array<Json> | Map<String, Json>` (§3.17), and the two forms JSON takes outside
 * an instance: text, and the JavaScript values a host works with. The compiled codecs turn typed
 * values into `Json` and back (docs/arch/boundary.md); this module only moves `Json` across, for
 * the json module's natives and the runtime's host boundary alike.
 *
 * - A `Json` value is its union's enum's variant (definition/types.ts): each member's variant is
 *   found in the entry by what its one field holds, `None` by holding nothing, never by a variant's
 *   name, which is the member as the compiler spells it.
 * - A host sees what `JSON.parse` of the text would give it, except that every integer is a
 *   `bigint`, so none loses digits and a host can tell an `Int` from a `Float`. Coming back, a
 *   bigint or a whole number is an `Int`, any other number a `Float`, so a host need not say which
 *   it means; and `undefined` reads as `JSON.stringify` writes it, `null`, or a field left out of
 *   an object, so a host function returning nothing gives `Unit` or `none`.
 * - Text is that JavaScript value in the canonical form (definition/codec.ts): an integer keeps
 *   every digit at any size and an object's entries are sorted by key, so equal values always give
 *   the same text (§9). A float JSON can't hold, NaN or an infinity, is `null`, as
 *   `JSON.stringify` writes it. A key given twice with different values is refused rather than
 *   resolved by position, since the two readers of such text could disagree.
 * - `Json` nests no deeper than a persisted value may (`maximumDepth`), checked before either
 *   form is walked, so deep input is refused instead of overflowing the host's stack.
 */

import { qualifiedName, wellKnown } from '../language/well-known.ts';
import { memo } from '../structures/memo.ts';
import { unreachable } from '../structures/unreachable.ts';
import { decodeJson, encodeJson, NestingError } from './codec.ts';
import { mapOf } from './equality.ts';
import type { TypeId } from './operands.ts';
import { hasRole, type TypeDefinition, type TypeReference } from './types.ts';
import { elementsOf, isComposite, mapValueOf, maximumDepth, type Value } from './values.ts';

/** A member of `Json`, by what its values are. */
type JsonMember = 'None' | 'Bool' | 'Int' | 'Float' | 'String' | 'Array' | 'Map';

/** The type entry the program's `Json` has, and the variant each member's values are. */
export interface JsonType {
  readonly type: TypeId;
  readonly variants: Readonly<Record<JsonMember, number>>;
  /** Each variant's member, by its index: the inverse of `variants`. */
  readonly members: readonly JsonMember[];
}

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
  const type = types.findIndex((_entry, index) => hasRole(types, index, 'json'));
  const entry = types[type];
  if (entry?.kind !== 'enum') {
    return undefined;
  }
  const members = entry.variants.map(({ fields: [field] }) => memberHolding(types, field?.type));
  const variants = Object.fromEntries(members.map((member, index) => [member, index]));
  return { type, variants: variants as Record<JsonMember, number>, members };
}

/** The member whose variant's one field has the type `reference`; `None`'s holds nothing. */
function memberHolding(
  types: readonly TypeDefinition[],
  reference: TypeReference | undefined,
): JsonMember {
  switch (reference?.kind) {
    case undefined:
      return 'None';
    case 'primitive':
      if (reference.name === 'Bool' || reference.name === 'Int' || reference.name === 'Float') {
        return reference.name;
      }
      return reference.name === 'String' ? 'String' : unreachable('Json holds no such primitive.');
    case 'named': {
      const name = types[reference.type]?.name;
      if (name === qualifiedName(wellKnown.array)) {
        return 'Array';
      }
      return name === qualifiedName(wellKnown.map)
        ? 'Map'
        : unreachable('Json holds no such type.');
    }
    default:
      return unreachable('Json holds no structural type.');
  }
}

/** Why JSON couldn't be read or written. */
export class JsonError extends Error {
  override readonly name = 'JsonError';
}

/** `json` as JSON text. */
export function jsonText(json: Value, shape: JsonType): string {
  return encodeJson(plainOfJson(json, shape));
}

/** The `Json` value JSON text holds; a JsonError for text that isn't JSON or nests too deeply. */
export function jsonOfText(text: string, shape: JsonType): Value {
  let parsed: unknown;
  try {
    parsed = decodeJson(text, maximumDepth);
  } catch (error) {
    throw new JsonError(unreadMessage(error), { cause: error });
  }
  return jsonOfPlain(parsed, shape);
}

/** Why JSON text couldn't be read, as `decodeJson` refused it. */
function unreadMessage(error: unknown): string {
  if (error instanceof NestingError) {
    return `JSON nests deeper than ${maximumDepth} levels.`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** `json` as the JavaScript value a host works with: `JSON.parse` of its text, integers as bigints. */
export function plainOfJson(json: Value, shape: JsonType, depth = 0): unknown {
  const [member, value] = partsOf(json, shape, depth);
  switch (member) {
    case 'None':
      return null;
    case 'Bool':
    case 'Int':
    case 'String':
      return value;
    case 'Float':
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    case 'Array':
      return elementsOf(value).map((item) => plainOfJson(item, shape, depth + 1));
    case 'Map':
      return Object.fromEntries(
        mapValueOf(value).entries.map(([key, item]) => [
          String(key),
          plainOfJson(item, shape, depth + 1),
        ]),
      );
    default: {
      const unhandled: never = member;
      return unhandled;
    }
  }
}

/** The `Json` value a JavaScript value holds; a JsonError for one that JSON can't hold. */
export function jsonOfPlain(plain: unknown, shape: JsonType, depth = 0): Value {
  if (depth > maximumDepth) {
    throw new JsonError(`JSON nests deeper than ${maximumDepth} levels.`);
  }
  const of = (member: JsonMember, value?: Value): Value => ({
    kind: 'variant',
    type: shape.type,
    variant: shape.variants[member],
    fields: value === undefined ? [] : [value],
  });
  switch (typeof plain) {
    case 'boolean':
      return of('Bool', plain);
    case 'string':
      return of('String', plain);
    case 'undefined':
      return of('None');
    case 'bigint':
      return of('Int', plain);
    case 'number':
      if (!Number.isFinite(plain)) {
        throw new JsonError(`JSON can't hold the number ${plain}.`);
      }
      return Number.isInteger(plain) ? of('Int', BigInt(plain)) : of('Float', plain);
    case 'object':
      if (plain === null) {
        return of('None');
      }
      if (Array.isArray(plain)) {
        const items = plain.map((item: unknown) => jsonOfPlain(item, shape, depth + 1));
        return of('Array', { kind: 'array', elements: items });
      }
      return of(
        'Map',
        mapOf(
          Object.entries(plain)
            .filter(([, item]) => item !== undefined)
            .map(([key, item]) => [key, jsonOfPlain(item, shape, depth + 1)]),
        ),
      );
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

/** The member `json` is a value of, and that value: what walking it reads at each level. */
function partsOf(
  json: Value,
  shape: JsonType,
  depth: number,
): readonly [JsonMember, Value | undefined] {
  if (depth > maximumDepth) {
    throw new JsonError(`JSON nests deeper than ${maximumDepth} levels.`);
  }
  if (!isJsonValue(json, shape)) {
    unreachable('Expected a Json value.');
  }
  const member = shape.members[json.variant] ?? unreachable('Json has no such variant.');
  return [member, json.fields[0]];
}
