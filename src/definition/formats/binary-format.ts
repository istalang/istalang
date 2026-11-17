/**
 * Binary persisted formats: a zod schema's values as avsc bytes (avro/), in the envelope every
 * persisted format has (format.ts), the format's name and version ahead of the body, so bytes from
 * another tool or of another version are refused saying so. The envelope is a zod schema too, so
 * its bytes are derived as the body's are.
 *
 * - Nothing but avsc runs on a value: writing refuses what doesn't fit the schema, reading what
 *   isn't its bytes, each as a FormatError. What a body must hold beyond its shape is for whoever
 *   reads bytes from outside the toolchain to check.
 * - One value always gives the same bytes (avro/), so their SHA-256 is their identity.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { avroCodecOf } from './avro/index.ts';
import { FormatError, requireEnvelope } from './format.ts';

/** What `contentHash` returns, for formats that refer to content by hash. */
export const contentHashText = z.string().regex(/^[0-9a-f]{64}$/u);

/** The SHA-256 of persisted bytes, as lowercase hex: the identity a store keys them by. */
export function contentHash(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export interface BinaryFormat<Value> {
  /** Encodes a value; throws FormatError where it doesn't fit the format. */
  readonly write: (value: Value) => Uint8Array;
  /** Decodes bytes; throws FormatError where they aren't this format's, of its version. */
  readonly read: (bytes: Uint8Array) => Value;
}

const header = { format: z.string(), version: z.int() };

/** The envelope alone, which every binary format's bytes start with. */
const headerCodec = avroCodecOf(z.strictObject(header));

/** Ties a body schema to a format name and version, as avsc bytes. */
export function defineBinaryFormat<Body extends z.ZodType>(
  name: string,
  version: number,
  body: Body,
): BinaryFormat<z.output<Body>> {
  const envelope = avroCodecOf(z.strictObject({ ...header, body }));
  return {
    write(value) {
      try {
        return envelope.write({ format: name, version, body: value });
      } catch (error) {
        throw new FormatError(`Invalid ${name} body: ${messageOf(error)}`, { cause: error });
      }
    },
    read(bytes) {
      requireEnvelope(name, version, headerOf(bytes, name));
      try {
        return (envelope.read(bytes) as { readonly body: z.output<Body> }).body;
      } catch (error) {
        throw new FormatError(`Invalid ${name} body: ${messageOf(error)}`, { cause: error });
      }
    },
  };
}

function headerOf(bytes: Uint8Array, name: string): { format: unknown; version: unknown } {
  let found: unknown;
  try {
    found = headerCodec.readStart(bytes);
  } catch (error) {
    throw new FormatError(`Not ${name} data: it has no envelope.`, { cause: error });
  }
  if (found === undefined) {
    throw new FormatError(`Not ${name} data: it has no envelope.`);
  }
  return found as { format: unknown; version: unknown };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
