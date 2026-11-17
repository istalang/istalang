/**
 * avsc's types as this folder names them. avsc is imported in this folder alone, through its
 * types-only entry (avsc-entry.d.ts), so the rest of the toolchain reaches Avro through
 * `avroCodecOf` (index.ts). Its types come from the package's own declarations, which are erased.
 */

import type avsc from 'avsc';
import type { z } from 'zod';

/** An Avro schema as avsc takes it, avsc types inside it included. */
export type AvroSchema = Parameters<typeof avsc.Type.forSchema>[0];

/** What avsc's `Type.forSchema` takes besides the schema. */
export type ForSchemaOptions = avsc.ForSchemaOptions;

/** avsc's wrapped union, whose branches a union's logical type names. */
export type WrappedUnionType = avsc.types.WrappedUnionType;

/** A zod schema of any kind, as the walk reads it. */
export type ZodSchema = z.core.$ZodType;
