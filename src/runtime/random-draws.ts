/**
 * The random draws of a run (§3.8 `random`, §5), alike on every runtime: draw `n` of a source
 * seeded with `seedBytes` secret bytes is HMAC-SHA-256 keyed by the seed over `n`, 32 bytes. A run
 * that draws again from the same seed draws what it drew before, as a segment run again from its
 * snapshot does, and no draw can be told from the others without the seed, which keeps draws fit
 * for tokens.
 * - **An instance's seed** is the host's seed's: HMAC-SHA-256 keyed by it over what the instance
 *   is, apart from its draws, whose messages are 8 bytes. A context is its key, which names one
 *   instance of the store; a live run, never persisted, its name and the count of the host's live
 *   starts before it, so the usual `main` and the context named after it (`runtime.id()`, §9) draw
 *   apart, and so do two starts under one name. Each kind's message has a prefix of its own. A
 *   spawned instance draws its seed from its parent's (§9).
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

/**
 * An instance a host makes, as its seed tells it apart: a context by its key; a live run by its
 * name and how many live runs the host started before it.
 */
export type SeededInstance =
  | { readonly kind: 'context'; readonly key: string }
  | { readonly kind: 'live'; readonly name: string; readonly start: number };

/** The seed of `instance`, made by a host with the seed `hostSeed`. */
export function instanceSeed(hostSeed: Uint8Array, instance: SeededInstance): Uint8Array {
  const message =
    instance.kind === 'context'
      ? `context:${instance.key}`
      : `live:${instance.start}:${instance.name}`;
  return hmac(sha256, hostSeed, utf8ToBytes(message));
}
