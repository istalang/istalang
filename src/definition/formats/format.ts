/**
 * Versioned persisted formats: the envelope every one has, and the JSON formats (snapshots, extern
 * signatures); a Definition is binary (binary-format.ts) in the same envelope.
 *
 * Each is persisted for an instance's whole life, so each is `{format, version, body}`. The body
 * is nested rather than spread beside the envelope's keys, so no body field can ever collide with
 * them. A reader checks the envelope before the body, so data from another tool or a newer version
 * is refused with a message that says so, rather than a list of schema mismatches. v0.1 has no
 * released instances, so a reader knows exactly one version and refuses the rest
 * (docs/arch/architecture.md, InstanceStore).
 *
 * A JSON body is a zod schema whose codecs turn JSON into the in-memory form (bigints, tagged
 * floats), so writing runs the same schema in reverse. That keeps one description per format, and
 * writing checks the shape too: a value it can't encode fails as the same FormatError reading gives.
 *
 * The codecs recurse on the host's stack, so a body nesting deeper than any valid one can is
 * refused before either runs (`maximumTextDepth`), whether it is read, on its text before it is
 * parsed, or written.
 */

import { z } from 'zod';
import { maximumDepth } from '../values/values.ts';
import { decodeJson, encodeJson, jsonDepth, NestingError } from './codec.ts';

/** How many levels a value's own level takes at most: a map's entry pair, its entry list, the map. */
const levelsPerValueLevel = 3;

/** How many levels a format's own structure around its values takes, with room to spare. */
const formatLevels = 32;

/** How deep a body may nest, so that every valid one fits and the codecs can walk it. */
const maximumTextDepth = levelsPerValueLevel * maximumDepth + formatLevels;

/** Raised when a persisted text can't be read as the expected format and version. */
export class FormatError extends Error {
  override readonly name = 'FormatError';
}

export interface Format<Body extends z.ZodType> {
  readonly name: string;
  readonly version: number;
  /** Decodes and validates a text; throws FormatError on any mismatch. */
  readonly read: (text: string) => z.output<Body>;
  /** Encodes a value as its canonical text, checking its shape alone; throws FormatError where it can't. */
  readonly write: (value: z.output<Body>) => string;
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
      const { body: contents, ...found } = readEnvelope(text, name);
      requireEnvelope(name, version, found);
      const result = body.safeParse(contents);
      if (!result.success) {
        throw invalid(name, z.prettifyError(result.error));
      }
      return result.data;
    },
    write(value) {
      requireShallow(name, value);
      const result = z.safeEncode(body, value);
      if (!result.success) {
        throw invalid(name, z.prettifyError(result.error));
      }
      return encodeJson({ format: name, version, body: result.data });
    },
  };
}

/** Refuses an envelope not of format `name` at `version`, saying which it is. */
export function requireEnvelope(
  name: string,
  version: number,
  found: { readonly format: unknown; readonly version: unknown },
): void {
  if (found.format !== name) {
    throw new FormatError(`Not ${name} data (format is ${JSON.stringify(found.format)}).`);
  }
  if (found.version !== version) {
    throw new FormatError(
      `${name} version ${String(found.version)} is not supported; this reader knows version ${version}.`,
    );
  }
}

/** Refuses a body to be written nesting deeper than `maximumTextDepth`, which the codecs can't walk. */
function requireShallow(name: string, contents: unknown): void {
  if (jsonDepth(contents) > maximumTextDepth) {
    throw new FormatError(`Invalid ${name} body: it nests deeper than ${maximumTextDepth} levels.`);
  }
}

/** One readable error for invalid content, whether it was being read or written. */
function invalid(name: string, problems: string): FormatError {
  return new FormatError(`Invalid ${name} body:\n${problems}`);
}

function readEnvelope(text: string, name: string): z.output<typeof envelope> {
  let json: unknown;
  try {
    // The body sits one level inside the envelope.
    json = decodeJson(text, maximumTextDepth + 1);
  } catch (error) {
    throw error instanceof NestingError
      ? new FormatError(`Invalid ${name} body: it nests deeper than ${maximumTextDepth} levels.`)
      : new FormatError(`Not a ${name} text: it isn't JSON.`, { cause: error });
  }
  const result = envelope.safeParse(json);
  if (!result.success) {
    throw new FormatError(
      `Not a ${name} text: it isn't a JSON object of exactly format, version and body.`,
    );
  }
  return result.data;
}
