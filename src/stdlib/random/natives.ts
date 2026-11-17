/**
 * The `random` module's natives (random.ista): integers and UUIDs drawn from the instance's random
 * source (runtime/random-draws.ts), so a segment that runs again draws the same values
 * (§5).
 *
 * An integer of a range is its start and a whole number of steps, uniform over every one it reaches
 * (ranges.ts). An integer below `n` reads as many bytes as `n - 1` needs, keeps as many low bits as
 * it has, and draws again whenever it lands at `n` or above, so every value is equally likely; each
 * try is likelier than not to land below `n`.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import { type NativeContext, type Natives, Panic, type WithRandom } from '../../runtime/natives.ts';
import { bounded, countOf, rangeOf, textOf } from '../ranges.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { given } from '../values/arguments.ts';

const rangeType = knownTypeKey(wellKnown.range);
const bitsPerByte = 8;
/**
 * A version 4 UUID (RFC 9562): 16 random bytes whose byte 6 starts with the version, 4, and byte 8
 * with the variant's bits, 10, written in hex.
 */
const uuid = {
  bytes: 16,
  versionByte: 6,
  version: 0x40,
  variantByte: 8,
  variant: 0x80,
  /** How many values the bits after the version's four, and after the variant's two, can take. */
  afterVersion: 0x10,
  afterVariant: 0x40,
  /** The hex digits in RFC 9562's groups of 8, 4, 4, 4 and 12. */
  layout: /^(?<timeLow>.{8})(?<timeMid>.{4})(?<timeHigh>.{4})(?<clock>.{4})(?<node>.{12})$/u,
} as const;

export const randomNatives = (keys: NativeKeys): Natives<NativeContext & WithRandom> => ({
  [keys.of('integer', rangeType)]: ([range], context) => {
    const from = bounded(rangeOf(context, given(range)), 'random.integer');
    const count = countOf(from);
    if (count === 0n) {
      throw new Panic(`random.integer has nothing to draw from the empty range ${textOf(from)}.`);
    }
    return from.start + from.step * uniformBelow(count, context.random.draw);
  },
  [keys.of('uuid')]: (_arguments, context) => uuidOf(context.random.draw()),
});

/** A uniform integer from 0 up to `bound`, which is positive, read from `draw`s. */
export function uniformBelow(bound: bigint, draw: () => Uint8Array): bigint {
  const bits = (bound - 1n).toString(2).length;
  const span = 2n ** BigInt(bits);
  for (;;) {
    const candidate = integerOf(drawn(Math.ceil(bits / bitsPerByte), draw)) % span;
    if (candidate < bound) {
      return candidate;
    }
  }
}

/** `count` bytes, from as many draws as they take. */
function drawn(count: number, draw: () => Uint8Array): Uint8Array {
  const bytes = new Uint8Array(count);
  for (let filled = 0; filled < count; ) {
    const next = draw().subarray(0, count - filled);
    bytes.set(next, filled);
    filled += next.length;
  }
  return bytes;
}

/** The unsigned integer `bytes` hold, most significant first. */
function integerOf(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes)}`);
}

/** The version 4 UUID made from `draw`'s first bytes, its version and variant bits set. */
function uuidOf(draw: Uint8Array): string {
  const bytes = Uint8Array.from(draw.subarray(0, uuid.bytes));
  bytes[uuid.versionByte] = uuid.version + ((bytes[uuid.versionByte] ?? 0) % uuid.afterVersion);
  bytes[uuid.variantByte] = uuid.variant + ((bytes[uuid.variantByte] ?? 0) % uuid.afterVariant);
  return bytesToHex(bytes).replace(
    uuid.layout,
    '$<timeLow>-$<timeMid>-$<timeHigh>-$<clock>-$<node>',
  );
}
