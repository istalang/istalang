/**
 * A literal as Avro holds it: a record of no fields, which takes no bytes, read back as the literal
 * the schema names. A record is named, so a literal can be a union's branch beside others.
 */

import avsc from 'avsc';
import type { AvroSchema } from './avsc-types.ts';

/** The record of no fields a literal is written as. */
const noFields = Object.freeze({});

/** The schema of a literal: a record of no fields naming its `constant`. */
export interface ConstantSchema {
  readonly type: 'record';
  readonly name: string;
  readonly fields: readonly [];
  readonly logicalType: string;
  readonly constant: unknown;
}

export class ConstantType extends avsc.types.LogicalType {
  readonly #constant: unknown;

  constructor(schema: ConstantSchema, options?: unknown) {
    super(schema as unknown as AvroSchema, options);
    this.#constant = schema.constant;
  }

  protected override _toValue(value: unknown): object {
    if (value !== this.#constant) {
      throw new TypeError(`Expected ${String(this.#constant)}, not ${String(value)}.`);
    }
    return noFields;
  }

  protected override _fromValue(): unknown {
    return this.#constant;
  }
}
