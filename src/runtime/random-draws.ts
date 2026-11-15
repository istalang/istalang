/**
 * The random draws of a run (§3.8 `random`, §5), alike on every runtime: draw `n` of a source
 * seeded with `seedBytes` secret bytes is HMAC-SHA-256 keyed by the seed over `n`, 32 bytes. A run
 * that draws again from the same seed draws what it drew before, the interpreter's segment run again
 * from its snapshot or compiled JavaScript diffed against it, and no draw can be told from the others
 * without the seed, which keeps draws fit for tokens.
 *
 * Hashing is computation, not I/O, so it runs on @noble/hashes, the project's one hash library,
 * which runs in Node and a browser alike.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Refusal } from './refusal.ts';

/** How many bytes a seed has. */
export const seedBytes = 32;

/** `bytes`, a host's seed; a Refusal unless there are `seedBytes` of them. */
export function seedOf(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== seedBytes) {
    throw new Refusal('unfitSeed', `A seed has ${seedBytes} bytes, not ${bytes.length}.`);
  }
  return bytes;
}

/** How many bytes a draw's index is hashed as: a 64-bit unsigned integer, most significant first. */
const indexBytes = 8;

/** Draw `index` of the source seeded with `seed`. */
export function drawOf(seed: Uint8Array, index: number): Uint8Array {
  const counter = new Uint8Array(indexBytes);
  new DataView(counter.buffer).setBigUint64(0, BigInt(index));
  return hmac(sha256, seed, counter);
}
