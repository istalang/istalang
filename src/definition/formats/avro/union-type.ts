/**
 * A union as Avro holds it: avsc's wrapped union, each value wrapped in the branch it picks as it is
 * written (branches.ts) and unwrapped as it is read, so neither side sees the wrapping.
 */

import avsc from 'avsc';
import type { AvroSchema } from './avsc-types.ts';

/** The schema of a union: its branches, how a value picks one, and what Avro's null stands for. */
export type UnionSchema = AvroSchema[] & {
  readonly logicalType: string;
  readonly branchOf: (value: unknown) => number;
  readonly nullValue: null | undefined;
};

/** A branch's value as avsc's wrapped union reads it. */
interface Wrapped {
  readonly unwrap: () => unknown;
}

export class UnionType extends avsc.types.LogicalType {
  readonly #branchOf: (value: unknown) => number;
  readonly #nullValue: null | undefined;
  readonly #names: readonly (string | undefined)[];

  constructor(schema: UnionSchema, options?: unknown) {
    super(schema as unknown as AvroSchema, options);
    this.#branchOf = schema.branchOf;
    this.#nullValue = schema.nullValue;
    this.#names = (this.underlyingType as avsc.types.WrappedUnionType).types.map(
      ({ branchName }) => branchName,
    );
  }

  protected override _toValue(value: unknown): unknown {
    const name = this.#names[this.#branchOf(value)];
    return name === 'null' || name === undefined ? null : { [name]: value };
  }

  protected override _fromValue(wrapped: Wrapped | null): unknown {
    return wrapped === null ? this.#nullValue : wrapped.unwrap();
  }
}
