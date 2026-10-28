/**
 * The one JSON text form for everything the toolchain persists or hashes: Definitions, snapshots
 * and, from M3, values crossing the host boundary.
 *
 * - Integers are exact at any size. lossless-json writes a bigint as plain digits and gives the
 *   decoder each number's source text, so an integer outside the safe range decodes to a bigint
 *   instead of being rounded. A safe integer decodes to a number, which keeps indexes plain.
 * - The text is canonical: object keys sorted by UTF-16 code unit (the order RFC 8785 uses), no
 *   whitespace. Equal values therefore have one text and one hash, whatever order their keys were
 *   built or received in.
 * - JSON has no float that differs from an integer. Schemas that need the distinction tag their
 *   floats (values.ts); this layer stays type-agnostic.
 */

import { createHash } from 'node:crypto';
import { parse, stringify } from 'lossless-json';
import { z } from 'zod';
import { compareOrdered } from '../language/values.ts';
import { unreachable } from '../structures/unreachable.ts';

const integerSyntax = /^-?\d+$/u;

/** What `contentHash` returns, for formats that refer to content by hash. */
export const contentHashText = z.string().regex(/^[0-9a-f]{64}$/u);

/** Encodes a JSON-shaped value (bigints allowed) as canonical text. */
export function encodeJson(value: unknown): string {
  const text = stringify(value, sortKeys);
  if (text === undefined) {
    unreachable('Only JSON-shaped values can be encoded.');
  }
  return text;
}

/** Decodes JSON text; integers outside the safe range come back as bigints. */
export function decodeJson(text: string): unknown {
  return parse(text, null, decodeNumber);
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

function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const entries = Object.entries(value).sort(([left], [right]) => compareOrdered(left, right));
  return Object.fromEntries(entries);
}

function decodeNumber(text: string): number | bigint {
  const number = Number(text);
  if (integerSyntax.test(text) && !Number.isSafeInteger(number)) {
    return BigInt(text);
  }
  return number;
}
