/**
 * Avro codecs derived from zod schemas, so a format avsc encodes keeps one description: its zod
 * schema, walked once here and never run on a value. A codec takes and gives plain bytes; avsc, its
 * types and its Buffers stay inside this folder.
 *
 * - What is walked is the in-memory side, a codec's output: avsc writes and reads the values the
 *   toolchain holds, with no pass converting them.
 * - A zod object is a named Avro record, its fields in the shape's order, so the bytes never depend
 *   on the order keys were built in; it reads back as a plain object (record-type.ts), so a decoded
 *   value is what the toolchain builds.
 * - A literal takes no bytes (constant-type.ts); a union picks its branch by the value
 *   (branches.ts), and an optional is a union whose null is the absent value.
 * - A bigint is its two's complement as Avro bytes (bigint-type.ts), so an Int of any size is
 *   written; `unknown` is its canonical JSON text (json-type.ts); a
 *   tuple is a record of its items (tuple-type.ts); a custom schema declares its form (forms.ts).
 */

import avsc from 'avsc/etc/browser/avsc-types.js';
import type { z } from 'zod';
import { avscBuffer } from './avsc-buffers.ts';
import type { AvroSchema, ForSchemaOptions, ZodSchema } from './avsc-types.ts';
import { BigintType } from './bigint-type.ts';
import {
  type Branch,
  branchChooser,
  discriminatorOf,
  leafBranch,
  onlyLiteral,
} from './branches.ts';
import { ConstantType } from './constant-type.ts';
import { customForm } from './forms.ts';
import { JsonType } from './json-type.ts';
import { type RecordSchema, RecordType } from './record-type.ts';
import { itemField, TupleType } from './tuple-type.ts';
import { type UnionSchema, UnionType } from './union-type.ts';

const logicalTypes = {
  'istalang-bigint': BigintType,
  'istalang-record': RecordType,
  'istalang-constant': ConstantType,
  'istalang-tuple': TupleType,
  'istalang-json': JsonType,
  'istalang-union': UnionType,
};

/** The values of a zod schema as Avro bytes, and back; each throws where they don't fit. */
export interface AvroCodec {
  readonly write: (value: unknown) => Uint8Array;
  /** Reads bytes holding exactly one value. */
  readonly read: (bytes: Uint8Array) => unknown;
  /** Reads the value `bytes` start with, ignoring what follows; undefined where they end first. */
  readonly readStart: (bytes: Uint8Array) => unknown;
}

/** The codec of the values `schema` describes in memory. */
export function avroCodecOf(schema: ZodSchema): AvroCodec {
  const type = avsc.Type.forSchema(new SchemaWalk().schemaOf(schema), {
    logicalTypes: logicalTypes as unknown as ForSchemaOptions['logicalTypes'],
    wrapUnions: true,
    omitRecordMethods: true,
    assertLogicalTypes: true,
  });
  return {
    write: (value) => type.toBuffer(value),
    read: (bytes) => type.fromBuffer(avscBuffer(bytes)),
    readStart: (bytes) => {
      const { value, offset } = type.decode(avscBuffer(bytes), 0);
      return offset < 0 ? undefined : value;
    },
  };
}

/** One walk of a zod schema into an Avro schema, naming its records as it goes. */
class SchemaWalk {
  /** Each object's record name, given where it is first written, which later ones refer to. */
  readonly #records = new Map<ZodSchema, string>();
  #names = 0;

  schemaOf(schema: ZodSchema): AvroSchema {
    const { def } = (schema as z.core.$ZodTypes)._zod;
    switch (def.type) {
      case 'object':
        return this.#record(schema, def.shape);
      case 'array':
        return { type: 'array', items: this.schemaOf(def.element) };
      case 'tuple':
        return this.#tuple(def.items, def.rest);
      case 'union':
      case 'optional':
        return this.#union(schema);
      case 'pipe':
        return this.schemaOf(def.out);
      case 'literal':
        return this.#constant(onlyLiteral(def.values));
      case 'enum':
        return {
          type: 'enum',
          name: this.#name(),
          symbols: Object.values(def.entries).map(String),
        };
      case 'string':
      case 'boolean':
      case 'null':
        return def.type;
      case 'number':
        return 'format' in def && def.format === 'safeint' ? 'long' : 'double';
      case 'bigint':
        return { type: 'bytes', logicalType: 'istalang-bigint' };
      case 'unknown':
        return { type: 'string', logicalType: 'istalang-json' };
      case 'custom':
        return customForm(schema);
      default:
        throw new TypeError(`A zod ${def.type} has no Avro form.`);
    }
  }

  #record(schema: ZodSchema, shape: Readonly<Record<string, ZodSchema>>): AvroSchema {
    const known = this.#records.get(schema);
    if (known !== undefined) {
      return known;
    }
    const name = this.#name();
    this.#records.set(schema, name);
    const fields = Object.entries(shape).map(([field, type]) => ({
      name: field,
      type: this.schemaOf(type),
    }));
    const record: RecordSchema = { type: 'record', name, fields, logicalType: 'istalang-record' };
    return record as unknown as AvroSchema;
  }

  #tuple(items: readonly ZodSchema[], rest: ZodSchema | null): AvroSchema {
    if (rest !== null) {
      throw new TypeError('A zod tuple with rest items has no Avro form.');
    }
    const fields = items.map((item, at) => ({ name: itemField(at), type: this.schemaOf(item) }));
    return { type: 'record', name: this.#name(), fields, logicalType: 'istalang-tuple' };
  }

  #constant(constant: unknown): AvroSchema {
    const fields: [] = [];
    const schema = { type: 'record', name: this.#name(), fields, logicalType: 'istalang-constant' };
    return { ...schema, constant } as AvroSchema;
  }

  #union(schema: ZodSchema): AvroSchema {
    const branches = this.#branchesOf(schema);
    const union: UnionSchema = Object.assign(
      branches.map(({ schema: branch }) => branch),
      {
        logicalType: 'istalang-union',
        branchOf: branchChooser(branches, discriminatorOf(schema)),
        nullValue: branches.some(({ bucket }) => bucket === 'absent') ? undefined : null,
      },
    );
    return union as unknown as AvroSchema;
  }

  /** The leaves of a union, nested unions flattened, since Avro's can't nest. */
  #branchesOf(schema: ZodSchema): readonly Branch[] {
    const { def } = (schema as z.core.$ZodTypes)._zod;
    switch (def.type) {
      case 'union':
        return def.options.flatMap((option) => this.#branchesOf(option));
      case 'optional':
        return [
          { schema: 'null', bucket: 'absent', tags: new Map() },
          ...this.#branchesOf(def.innerType),
        ];
      case 'pipe':
        return this.#branchesOf(def.out);
      default:
        return [leafBranch(schema, this.schemaOf(schema))];
    }
  }

  #name(): string {
    this.#names += 1;
    return `T${this.#names}`;
  }
}
