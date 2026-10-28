/**
 * The seed of an instance's random source (§3.8 `random`): `seedBytes` bytes, which a host gives
 * for each instance it starts (the `seed` seam, host.ts), and a snapshot keeps as lowercase hex. A
 * spawned instance's seed is a draw from its parent's source, which is as long
 * (scheduler/random-source.ts).
 */

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
export function seedBytesOf(text: string): Uint8Array {
  return Buffer.from(text, 'hex');
}
