/**
 * An instance's random values (§3.8 `random`, §5): a secret seed and a count of the draws its
 * committed segments made, both in its snapshot. The seed is `seedBytes` bytes, which a host gives
 * for each instance it starts (the `seed` seam, host.ts), and a snapshot keeps as lowercase hex. A
 * spawned instance's seed is a draw from its parent's source, which is as long.
 *
 * Draw `n` is HMAC-SHA-256 keyed by the seed over `n`, 32 bytes, so a segment that runs again from
 * its snapshot draws what it drew before, and no draw can be told from the others without the
 * seed, which keeps draws fit for tokens. Hashing is computation, not I/O, so the runtime reaches
 * `node:crypto` itself (architecture: Layers).
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { Refusal } from './refusal.ts';

/** How many bytes a seed has. */
export const seedBytes = 32;

const hexDigitsPerByte = 2;

/** A seed as a snapshot keeps it. */
export const seedText = z
  .string()
  .regex(new RegExp(`^[0-9a-f]{${seedBytes * hexDigitsPerByte}}$`, 'u'));

/** `bytes` as a snapshot keeps a seed; a Refusal unless there are `seedBytes` of them. */
export function seedTextOf(bytes: Uint8Array): string {
  if (bytes.length !== seedBytes) {
    throw new Refusal('unfitSeed', `A seed has ${seedBytes} bytes, not ${bytes.length}.`);
  }
  return Buffer.from(bytes).toString('hex');
}

/** A seed made from the first `seedBytes` of `bytes`, as a snapshot keeps it. */
export function seedFrom(bytes: Uint8Array): string {
  return seedTextOf(bytes.subarray(0, seedBytes));
}

/** The bytes a seed's text holds. */
function seedBytesOf(text: string): Uint8Array {
  return Buffer.from(text, 'hex');
}

/** How many bytes a draw's index is hashed as: a 64-bit unsigned integer, most significant first. */
const indexBytes = 8;

/** Draw `index` of the source seeded with `seed`, a seed's text. */
export function drawOf(seed: string, index: number): Uint8Array {
  const counter = new DataView(new ArrayBuffer(indexBytes));
  counter.setBigUint64(0, BigInt(index));
  return createHmac('sha256', seedBytesOf(seed)).update(counter).digest();
}
