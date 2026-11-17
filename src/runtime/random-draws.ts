/**
 * The random draws of a run (§3.8 `random`, §5), alike on every runtime: draw `n` of a source
 * seeded with `seedBytes` secret bytes is HMAC-SHA-256 keyed by the seed over `n`, 32 bytes. A run
 * that draws again from the same seed draws what it drew before, as a segment run again from its
 * snapshot does, and no draw can be told from the others without the seed, which keeps draws fit
 * for tokens.
 * - **An instance's seed** is the host's seed's: HMAC-SHA-256 keyed by it over `instance ` and the
 *   instance's name, so every instance a host makes draws from a source of its own, apart from its
 *   draws, whose messages are 8 bytes. A spawned instance draws its seed from its parent (§9).
 *
 * Hashing is computation, not I/O, so it runs on @noble/hashes, the project's one hash library,
 * which runs in Node and a browser alike.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

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

/** The seed of the instance `name` a host with the seed `hostSeed` makes. */
export function instanceSeed(hostSeed: Uint8Array, name: string): Uint8Array {
  return hmac(sha256, hostSeed, utf8ToBytes(`instance ${name}`));
}
