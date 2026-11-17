/**
 * The random draws of a run (§3.8 `random`, §5), alike on every runtime: draw `n` of a source
 * seeded with `seedBytes` secret bytes is HMAC-SHA-256 keyed by the seed over `n`, 32 bytes. A run
 * that draws again from the same seed draws what it drew before, as a segment run again from its
 * snapshot does, and no draw can be told from the others without the seed, which keeps draws fit
 * for tokens.
 *
 * Hashing is computation, not I/O, so it runs on @noble/hashes, the project's one hash library,
 * which runs in Node and a browser alike.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** How many bytes a seed has. */
export const seedBytes = 32;
/** How many bytes a draw's index is hashed as: a 64-bit unsigned integer, most significant first. */
const indexBytes = 8;

/** Draw `index` of the source seeded with `seed`. */
export function drawOf(seed: Uint8Array, index: number): Uint8Array {
  const counter = new Uint8Array(indexBytes);
  new DataView(counter.buffer).setBigUint64(0, BigInt(index));
  return hmac(sha256, seed, counter);
}
