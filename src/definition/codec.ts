/**
 * The one JSON text form for everything the toolchain persists or hashes: Definitions, snapshots
 * and, from M3, values crossing the host boundary.
 *
 * - Integers are exact at any size. lossless-json writes a bigint as plain digits and gives the
 *   decoder each number's source text, so an integer outside the safe range decodes to a bigint
 *   instead of being rounded. A safe integer decodes to a number, which keeps indexes plain.
 * - The text is canonical: object keys sorted by UTF-16 code unit (the order RFC 8785 uses), no
 *   whitespace. Equal values therefore have one text and one hash, whatever order their keys were
 *   built or received in. It is written from the sorted entries themselves, since a JavaScript
 *   object puts keys that spell array indexes first, in numeric order, whatever order it is given.
 * - A reader may bound how deeply the text nests: that is checked on the text itself, before the
 *   parser, which recurses on the host's stack, walks it (`NestingError`).
 * - JSON has no float that differs from an integer. Schemas that need the distinction tag their
 *   floats (values.ts); this layer stays type-agnostic.
 */

import { createHash } from 'node:crypto';
import { parse } from 'lossless-json';
import { z } from 'zod';
import { compareOrdered } from '../language/order.ts';
import { unreachable } from '../structures/unreachable.ts';

const integerSyntax = /^-?\d+$/u;

/** What `contentHash` returns, for formats that refer to content by hash. */
export const contentHashText = z.string().regex(/^[0-9a-f]{64}$/u);

/**
 * Encodes a JSON-shaped value (bigints allowed) as canonical text: `undefined` is left out of an
 * object and written as `null` in an array, as `JSON.stringify` does.
 */
export function encodeJson(value: unknown): string {
  if (value === undefined) {
    unreachable('Only JSON-shaped values can be encoded.');
  }
  return written(value);
}

function written(value: unknown): string {
  switch (typeof value) {
    case 'bigint':
      return value.toString();
    case 'number':
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      return 'null';
    case 'object':
      if (value === null) {
        return 'null';
      }
      if (Array.isArray(value)) {
        return `[${value.map(written).join(',')}]`;
      }
      return `{${Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareOrdered(left, right))
        .map(([key, item]) => `${JSON.stringify(key)}:${written(item)}`)
        .join(',')}}`;
    default:
      return unreachable(`JSON holds no ${typeof value}.`);
  }
}

/** Raised where JSON text nests deeper than its reader allows. */
export class NestingError extends Error {
  override readonly name = 'NestingError';
}

/**
 * Decodes JSON text; integers outside the safe range come back as bigints. Text nesting deeper
 * than `deepest` levels is refused before it is parsed (`NestingError`).
 */
export function decodeJson(text: string, deepest = Number.POSITIVE_INFINITY): unknown {
  if (textDepth(text) > deepest) {
    throw new NestingError(`JSON text nests deeper than ${deepest} levels.`);
  }
  return parse(text, null, decodeNumber);
}

/** A JSON string, escapes included, and what isn't a bracket: what nesting depth skips. */
const jsonStrings = /"(?:[^"\\]|\\.)*"/gu;
const notBrackets = /[^[\]{}]/gu;

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

/** How deep a JSON-shaped value nests, each array and object a level; walked with a stack of its own. */
export function jsonDepth(value: unknown): number {
  let deepest = 0;
  const pending: (readonly [unknown, number])[] = [[value, 0]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [item, depth] = next;
    if (item !== null && typeof item === 'object') {
      deepest = Math.max(deepest, depth + 1);
      for (const child of Object.values(item)) {
        pending.push([child, depth + 1]);
      }
    }
  }
  return deepest;
}

/** The SHA-256 of a canonical text, as lowercase hex: the identity a store keys content by. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function decodeNumber(text: string): number | bigint {
  const number = Number(text);
  if (integerSyntax.test(text) && !Number.isSafeInteger(number)) {
    return BigInt(text);
  }
  return number;
}
