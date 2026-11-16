/**
 * An Int as Avro holds it: its bigint as Avro bytes, big-endian two's complement in as few bytes as
 * hold it (Avro's decimal does the same), so an Int of any size is written, and a small one takes
 * as few bytes as a long would.
 */

import avsc from 'avsc';
import type { AvroSchema } from './avsc-types.ts';

const byteBits = 8;

const hex = 16;

/** Hex digits per byte. */
const byteDigits = 2;

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
  protected override _toValue(value: unknown): Buffer {
    if (typeof value !== 'bigint') {
      throw new TypeError(`Expected an Int, not ${String(value)}.`);
    }
    const count = byteCountOf(value);
    const digits = BigInt.asUintN(count * byteBits, value).toString(hex);
    return Buffer.from(digits.padStart(count * byteDigits, '0'), 'hex');
  }

  // biome-ignore lint/style/useThisInClassMethods: avsc calls a logical type's conversions as its methods.
  protected override _fromValue(bytes: Buffer): bigint {
    return bytes.length === 0
      ? 0n
      : BigInt.asIntN(bytes.length * byteBits, BigInt(`0x${bytes.toString('hex')}`));
  }
}
