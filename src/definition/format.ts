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
 *
 * The codecs recurse on the host's stack, so a body nesting deeper than any valid one can is
 * refused before either runs (`maximumTextDepth`), whether it is read, on its text before it is
 * parsed, or written.
 */

import { z } from 'zod';
import { contentHash, decodeJson, encodeJson, jsonDepth, NestingError } from './codec.ts';
import { maximumDepth } from './values.ts';

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

/** A written value: its canonical text, and the hash a store keys it by. */
interface Persisted {
  readonly text: string;
  readonly hash: string;
}

/** A text read and written back: its value, its canonical text and that text's hash. */
interface Canonical<Value> extends Persisted {
  readonly value: Value;
}

export interface Format<Body extends z.ZodType> {
  readonly name: string;
  readonly version: number;
  /** Decodes and validates a text; throws FormatError on any mismatch. */
  readonly read: (text: string) => z.output<Body>;
  readonly write: (value: z.output<Body>) => Persisted;
  /**
   * Reads a text and writes its value back, for a reader that keys what it read by its hash; throws
   * FormatError as `read` does.
   */
  readonly readCanonical: (text: string) => Canonical<z.output<Body>>;
}

const envelope = z.strictObject({ format: z.unknown(), version: z.unknown(), body: z.unknown() });

/** Ties a body schema to a format name and version. */
export function defineFormat<Body extends z.ZodType>(
  name: string,
  version: number,
  body: Body,
): Format<Body> {
  const persisted: Format<Body> = {
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
      requireShallow(name, value);
      const result = z.safeEncode(body, value);
      if (!result.success) {
        throw invalid(name, result.error);
      }
      const text = encodeJson({ format: name, version, body: result.data });
      return { text, hash: contentHash(text) };
    },
    readCanonical(text) {
      const value = persisted.read(text);
      return { value, ...persisted.write(value) };
    },
  };
  return persisted;
}

/** Refuses a body to be written nesting deeper than `maximumTextDepth`, which the codecs can't walk. */
function requireShallow(name: string, contents: unknown): void {
  if (jsonDepth(contents) > maximumTextDepth) {
    throw new FormatError(`Invalid ${name} body: it nests deeper than ${maximumTextDepth} levels.`);
  }
}

/** One readable error for invalid content, whether it was being read or written. */
function invalid(name: string, error: z.ZodError): FormatError {
  return new FormatError(`Invalid ${name} body:\n${z.prettifyError(error)}`);
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
