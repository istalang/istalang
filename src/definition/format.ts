/**
 * Versioned persisted formats: the envelope Definitions and snapshots share.
 *
 * Both are persisted for an instance's whole life, so each text is `{format, version, body}`. The
 * body is nested rather than spread beside the envelope's keys, so no body field can ever collide
 * with them. A reader checks the envelope before the body, so data from another tool or a newer
 * version is refused with a message that says so, rather than a list of schema mismatches. v0.1
 * has no released instances, so a reader knows exactly one version and refuses the rest
 * (docs/arch/architecture.md, InstanceStore).
 *
 * The body is a zod schema whose codecs turn JSON into the in-memory form (bigints, tagged
 * floats), so writing runs the same schema in reverse. That keeps one description per format,
 * and writing validates too: invalid content fails as the same FormatError reading gives.
 */

import { z } from 'zod';
import { contentHash, decodeJson, encodeJson } from './codec.ts';

/** Raised when a persisted text can't be read as the expected format and version. */
export class FormatError extends Error {
  override readonly name = 'FormatError';
}

/** A written value: its canonical text, and the hash a store keys it by. */
export interface Persisted {
  readonly text: string;
  readonly hash: string;
}

export interface Format<Body extends z.ZodType> {
  readonly name: string;
  readonly version: number;
  /** Decodes and validates a text; throws FormatError on any mismatch. */
  readonly read: (text: string) => z.output<Body>;
  readonly write: (value: z.output<Body>) => Persisted;
}

const envelope = z.strictObject({ format: z.unknown(), version: z.unknown(), body: z.unknown() });

/** Ties a body schema to a format name and version. */
export function defineFormat<Body extends z.ZodType>(
  name: string,
  version: number,
  body: Body,
): Format<Body> {
  return {
    name,
    version,
    read(text) {
      const { format, version: found, body: contents } = readEnvelope(text, name);
      if (format !== name) {
        throw new FormatError(`Not a ${name} text (format is ${JSON.stringify(format)}).`);
      }
      if (found !== version) {
        throw new FormatError(
          `${name} version ${String(found)} is not supported; this reader knows version ${version}.`,
        );
      }
      const result = body.safeParse(contents);
      if (!result.success) {
        throw invalid(name, result.error);
      }
      return result.data;
    },
    write(value) {
      const result = z.safeEncode(body, value);
      if (!result.success) {
        throw invalid(name, result.error);
      }
      const text = encodeJson({ format: name, version, body: result.data });
      return { text, hash: contentHash(text) };
    },
  };
}

/** One readable error for invalid content, whether it was being read or written. */
function invalid(name: string, error: z.ZodError): FormatError {
  return new FormatError(`Invalid ${name} body:\n${z.prettifyError(error)}`);
}

function readEnvelope(text: string, name: string): z.output<typeof envelope> {
  let json: unknown;
  try {
    json = decodeJson(text);
  } catch (error) {
    throw new FormatError(`Not a ${name} text: it isn't JSON.`, { cause: error });
  }
  const result = envelope.safeParse(json);
  if (!result.success) {
    throw new FormatError(
      `Not a ${name} text: it isn't a JSON object of exactly format, version and body.`,
    );
  }
  return result.data;
}
