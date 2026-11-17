/**
 * An Int as Avro holds it: its bigint as Avro bytes, big-endian two's complement in as few bytes as
 * hold it (Avro's decimal does the same), so an Int of any size is written, and a small one takes
 * as few bytes as a long would.
 */

import avsc from 'avsc/etc/browser/avsc-types.js';
import { avscBuffer } from './avsc-buffers.ts';
import type { AvroSchema } from './avsc-types.ts';

const byteBits = 8;

/** The values one byte holds. */
const byteBase = 2n ** BigInt(byteBits);

/** The fewest bytes of two's complement that hold `value`. */
function byteCountOf(value: bigint): number {
  let count = 1;
  while (BigInt.asIntN(count * byteBits, value) !== value) {
    count += 1;
  }
  return count;
}

export class BigintType extends avsc.types.LogicalType {
  constructor(schema: AvroSchema, options?: unknown) {
    super(schema, options);
  }

  // biome-ignore lint/style/useThisInClassMethods: avsc calls a logical type's conversions as its methods.
  protected override _toValue(value: unknown): Uint8Array {
    if (typeof value !== 'bigint') {
      throw new TypeError(`Expected an Int, not ${String(value)}.`);
    }
    const bytes = new Uint8Array(byteCountOf(value));
    let rest = BigInt.asUintN(bytes.length * byteBits, value);
    for (let at = bytes.length - 1; at >= 0; at -= 1) {
      bytes[at] = Number(rest % byteBase);
      rest /= byteBase;
    }
    return avscBuffer(bytes);
  }

  // biome-ignore lint/style/useThisInClassMethods: avsc calls a logical type's conversions as its methods.
  protected override _fromValue(bytes: Uint8Array): bigint {
    let value = 0n;
    for (const byte of bytes) {
      value = value * byteBase + BigInt(byte);
    }
    return BigInt.asIntN(bytes.length * byteBits, value);
  }
}
