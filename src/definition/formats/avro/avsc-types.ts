/**
 * avsc's types as this folder names them: avsc is imported here and in the logical types beside
 * it alone, so the rest of the toolchain reaches Avro through `avroTypeOf` (index.ts).
 */

import type avsc from 'avsc';
import type { z } from 'zod';

/** An avsc type: what writes and reads a value's bytes. */
export type AvroType = avsc.Type;

/** An Avro schema as avsc takes it, avsc types inside it included. */
export type AvroSchema = Parameters<typeof avsc.Type.forSchema>[0];

/** A zod schema of any kind, as the walk reads it. */
export type ZodSchema = z.core.$ZodType;
