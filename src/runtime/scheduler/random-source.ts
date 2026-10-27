/**
 * An instance's random source (§3.8 `random`, §5): a secret seed (random-seed.ts) and a count of the
 * draws its committed segments made, both in its snapshot. Draw `n` is HMAC-SHA-256 keyed by the
 * seed over `n`, 32 bytes, so a segment that runs again from its snapshot draws what it drew
 * before, and no draw can be told from the others without the seed, which keeps draws fit for
 * tokens. Hashing is computation, not I/O, so the runtime reaches `node:crypto` itself
 * (architecture: Layers).
 */

import { createHmac } from 'node:crypto';
import { seedBytesOf } from '../random-seed.ts';

/** How many bytes a draw's index is hashed as: a 64-bit unsigned integer, most significant first. */
const indexBytes = 8;

/** Draw `index` of the source seeded with `seed`, a seed's text. */
export function drawOf(seed: string, index: number): Uint8Array {
  const counter = new DataView(new ArrayBuffer(indexBytes));
  counter.setBigUint64(0, BigInt(index));
  return createHmac('sha256', seedBytesOf(seed)).update(counter).digest();
}
