/**
 * A zod object as Avro holds it: a record of its fields in the shape's order, read back as a plain
 * object holding the fields that are present, so a decoded value is what the toolchain builds:
 * an absent optional field absent, not a key holding undefined, whatever avsc's record instance
 * holds. A name referring to a record resolves to this type, so every occurrence reads alike.
 */

import avsc from 'avsc/etc/browser/avsc-types.js';
import type { AvroSchema } from './avsc-types.ts';

/** The schema of a record: its name and its fields, in order. */
export interface RecordSchema {
  readonly type: 'record';
  readonly name: string;
  readonly fields: readonly { readonly name: string; readonly type: AvroSchema }[];
  readonly logicalType: string;
}

export class RecordType extends avsc.types.LogicalType {
  readonly #fields: readonly string[];

  constructor(schema: RecordSchema, options?: unknown) {
    super(schema as unknown as AvroSchema, options);
    this.#fields = schema.fields.map(({ name }) => name);
  }

  // biome-ignore lint/style/useThisInClassMethods: avsc calls a logical type's conversions as its methods.
  protected override _toValue(value: unknown): unknown {
    return value;
  }

  protected override _fromValue(record: Readonly<Record<string, unknown>>): object {
    const plain: Record<string, unknown> = {};
    for (const field of this.#fields) {
      const value = record[field];
      if (value !== undefined) {
        plain[field] = value;
      }
    }
    return plain;
  }
}
