/**
 * An instance's random values (§3.8 `random`, §5): a secret seed and a count of the draws its
 * committed segments made, both in its snapshot. The seed is `seedBytes` bytes, which a host gives
 * for each instance it starts (the `seed` seam, ../host/index.ts), and a snapshot keeps as lowercase
 * hex. A spawned instance's seed is a draw from its parent's source, which is as long. What a draw
 * is, every runtime reads in ../random-draws.ts.
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { seedBytes, seedOf } from '../random-draws.ts';

const hexDigitsPerByte = 2;

/** A seed as a snapshot keeps it. */
export const seedText = z
  .string()
  .regex(new RegExp(`^[0-9a-f]{${seedBytes * hexDigitsPerByte}}$`, 'u'));

/** `bytes` as a snapshot keeps a seed; a Refusal unless there are `seedBytes` of them. */
export function seedTextOf(bytes: Uint8Array): string {
  return bytesToHex(seedOf(bytes));
}

/** A seed made from the first `seedBytes` of `bytes`, as a snapshot keeps it. */
export function seedFrom(bytes: Uint8Array): string {
  return seedTextOf(bytes.subarray(0, seedBytes));
}

/** The bytes a seed's text holds. */
export function seedBytesOf(text: string): Uint8Array {
  return hexToBytes(text);
}
