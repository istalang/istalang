/** A tuple as Avro holds it: the record of its items, `item0` on, which Avro's names allow. */

import avsc from 'avsc/etc/browser/avsc-types.js';
import type { AvroSchema } from './avsc-types.ts';

/** The name of a tuple's item `at` as its record's field. */
export function itemField(at: number): string {
  return `item${at}`;
}

export class TupleType extends avsc.types.LogicalType {
  readonly #items: readonly string[];

  constructor(
    schema: { readonly fields: readonly { readonly name: string }[] },
    options?: unknown,
  ) {
    super(schema as AvroSchema, options);
    this.#items = schema.fields.map(({ name }) => name);
  }

  protected override _toValue(tuple: readonly unknown[]): Record<string, unknown> {
    return Object.fromEntries(this.#items.map((item, at) => [item, tuple[at]]));
  }

  protected override _fromValue(record: Readonly<Record<string, unknown>>): unknown[] {
    return this.#items.map((item) => record[item]);
  }
}
