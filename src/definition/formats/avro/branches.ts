/**
 * A union's branches as Avro holds them: Avro's can't nest, so nested unions are flattened, and
 * each value picks its branch by its JavaScript type and, among objects, by the literal field that
 * tells them apart (a discriminated union's key, else the first one every branch has). A union no
 * such rule tells apart is refused as its type is derived, never guessed at as a value is written.
 */

import type { z } from 'zod';
import type { AvroSchema, ZodSchema } from './avsc-types.ts';
import { type AvroPrimitive, customForm } from './forms.ts';

/** What a JavaScript value is, as far as choosing a union's branch for it goes. */
type Bucket = 'absent' | 'null' | 'boolean' | 'string' | 'number' | 'bigint' | 'array' | 'object';

/** A union's branch: its Avro schema, the values it takes, and its literal fields (an object's). */
export interface Branch {
  readonly schema: AvroSchema;
  readonly bucket: Bucket;
  readonly tags: ReadonlyMap<string, unknown>;
}

const primitiveBuckets: Readonly<Record<AvroPrimitive, Bucket>> = {
  boolean: 'boolean',
  long: 'number',
  double: 'number',
  string: 'string',
};

/** The value of a literal of one value; throws for one of several, which has no Avro form. */
export function onlyLiteral(values: readonly unknown[]): unknown {
  const [only] = values;
  if (values.length !== 1) {
    throw new TypeError('Only a zod literal of one value has an Avro form.');
  }
  return only;
}

/** A union's leaf `schema`, written as `avro`. */
export function leafBranch(schema: ZodSchema, avro: AvroSchema): Branch {
  return { schema: avro, bucket: bucketOf(schema), tags: tagsOf(schema) };
}

/** What values a union's leaf takes, by their JavaScript type. */
function bucketOf(schema: ZodSchema): Bucket {
  const { def } = (schema as z.core.$ZodTypes)._zod;
  switch (def.type) {
    case 'null':
    case 'boolean':
    case 'string':
    case 'number':
    case 'bigint':
    case 'array':
    case 'object':
      return def.type;
    case 'enum':
      return 'string';
    case 'tuple':
      return 'array';
    case 'literal':
      return bucketOfValue(onlyLiteral(def.values));
    case 'custom':
      return primitiveBuckets[customForm(schema)];
    default:
      throw new TypeError(`A zod ${def.type} can't be a branch of a union with an Avro form.`);
  }
}

/** An object's fields that are a literal of one value, by name. */
function tagsOf(schema: ZodSchema): ReadonlyMap<string, unknown> {
  const { def } = (schema as z.core.$ZodTypes)._zod;
  if (def.type !== 'object') {
    return new Map();
  }
  return new Map(
    Object.entries(def.shape).flatMap(([field, type]) => {
      const { def: fieldDef } = (type as z.core.$ZodTypes)._zod;
      return fieldDef.type === 'literal' && fieldDef.values.length === 1
        ? [[field, fieldDef.values[0]] as const]
        : [];
    }),
  );
}

/** The key a discriminated union names, which its objects' branches are told apart by. */
export function discriminatorOf(schema: ZodSchema): string | undefined {
  const { def } = (schema as z.core.$ZodTypes)._zod;
  return def.type === 'union' && 'discriminator' in def && typeof def.discriminator === 'string'
    ? def.discriminator
    : undefined;
}

function bucketOfValue(value: unknown): Bucket {
  if (value === undefined) {
    return 'absent';
  }
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value as Bucket;
}

/** How a value picks its branch of `branches`, telling objects apart by `discriminator` if named. */
export function branchChooser(
  branches: readonly Branch[],
  discriminator: string | undefined,
): (value: unknown) => number {
  const byBucket = new Map<Bucket, number>();
  const objects: number[] = [];
  branches.forEach(({ bucket }, at) => {
    if (bucket === 'object') {
      objects.push(at);
    } else if (byBucket.has(bucket)) {
      throw new TypeError(`A union with two ${bucket} branches has no Avro form.`);
    } else {
      byBucket.set(bucket, at);
    }
  });
  const [onlyObject] = objects;
  if (objects.length === 1 && onlyObject !== undefined) {
    byBucket.set('object', onlyObject);
  }
  const objectBranches = objects.map((at) => branches[at]);
  const tag = objects.length > 1 ? tagOf(objectBranches, discriminator) : '';
  const byTag = new Map(objects.map((at) => [branches[at]?.tags.get(tag), at]));
  return (value) => {
    const bucket = bucketOfValue(value);
    const tagged = (value as Readonly<Record<string, unknown>> | undefined)?.[tag];
    const at = byBucket.get(bucket) ?? (bucket === 'object' ? byTag.get(tagged) : undefined);
    if (at === undefined) {
      const which =
        bucket === 'object' ? `an object whose ${tag} is ${String(tagged)}` : `a ${bucket}`;
      throw new TypeError(`No branch of the union takes ${which}.`);
    }
    return at;
  };
}

/** The literal field that tells `objects` apart: `discriminator`, else the first that does. */
function tagOf(
  objects: readonly (Branch | undefined)[],
  discriminator: string | undefined,
): string {
  const [first] = objects;
  const candidates =
    discriminator === undefined ? [...(first?.tags.keys() ?? [])] : [discriminator];
  const tag = candidates.find((field) => {
    const values = objects.map((branch) => branch?.tags.get(field));
    return values.every((value) => value !== undefined) && new Set(values).size === values.length;
  });
  if (tag === undefined) {
    throw new TypeError('A union of objects no literal field tells apart has no Avro form.');
  }
  return tag;
}
