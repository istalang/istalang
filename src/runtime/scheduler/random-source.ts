/**
 * An instance's random source (§3.8 `random`, §5): a secret seed and a count of the draws its
 * committed segments made, both in its snapshot. Draw `n` is HMAC-SHA-256 keyed by the seed over
 * `n`, so a segment that runs again from its snapshot draws what it drew before, and no draw can
 * be told from the others without the seed, which keeps draws fit for tokens. Hashing is
 * computation, not I/O, so the runtime reaches `node:crypto` itself (architecture: Layers).
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';

/** How many bytes a seed has, and a draw gives. */
export const drawBytes = 32;

/** A seed as a snapshot keeps it: its bytes as lowercase hex. */
export const randomSeed = z.string().regex(/^[0-9a-f]{64}$/u);

/** How many bytes a draw's index is hashed as: a 64-bit unsigned integer, most significant first. */
const indexBytes = 8;

/** Draw `index` of the source seeded with `seed`: `drawBytes` bytes. */
export function drawOf(seed: string, index: number): Uint8Array {
  const counter = new DataView(new ArrayBuffer(indexBytes));
  counter.setBigUint64(0, BigInt(index));
  return createHmac('sha256', Buffer.from(seed, 'hex')).update(counter).digest();
}

/**
 * `bytes`, `drawBytes` of them, as a seed: a spawned instance's, drawn from its parent's source
 * (§9), or a new one's, from its host's entropy.
 */
export function seedOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}
