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
 * floats), so writing runs the same schema in reverse. That keeps one description per format, and
 * writing checks the shape too: a value it can't encode fails as the same FormatError reading gives.
 * What a body must hold beyond its shape (`problemsOf`, a Definition's validation) is checked once,
 * as a text is read, which every text goes through before anything runs of it.
 *
 * A reader keying what it read (`readKeyed`) keys the text it was given by its hash: what `write`
 * wrote is canonical already, so nothing is encoded again to key it.
 *
 * The codecs recurse on the host's stack, so a body nesting deeper than any valid one can is
 * refused before either runs (`maximumTextDepth`), whether it is read, on its text before it is
 * parsed, or written.
 */

import { z } from 'zod';
import { maximumDepth } from '../values/values.ts';
import { contentHash, decodeJson, encodeJson, jsonDepth, NestingError } from './codec.ts';

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

/** A text read: its value, the text, and the hash a store keys it by. */
interface Keyed<Value> extends Persisted {
  readonly value: Value;
}

/** What a body must hold beyond its shape: each way `value` breaks it, a message naming where. */
type Problems<Value> = (value: Value) => readonly string[];

export interface Format<Body extends z.ZodType> {
  readonly name: string;
  readonly version: number;
  /** Decodes and validates a text; throws FormatError on any mismatch. */
  readonly read: (text: string) => z.output<Body>;
  /** Encodes a value, checking its shape alone; throws FormatError where it can't. */
  readonly write: (value: z.output<Body>) => Persisted;
  /** Reads a text, for a reader that keys what it read by its hash; throws as `read` does. */
  readonly readKeyed: (text: string) => Keyed<z.output<Body>>;
}

const envelope = z.strictObject({ format: z.unknown(), version: z.unknown(), body: z.unknown() });

/** Ties a body schema, and what a body must hold beyond it, to a format name and version. */
export function defineFormat<Body extends z.ZodType>(
  name: string,
  version: number,
  body: Body,
  problemsOf: Problems<z.output<Body>> = () => [],
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
        throw invalid(name, z.prettifyError(result.error));
      }
      const problems = problemsOf(result.data);
      if (problems.length > 0) {
        throw invalid(name, problems.map((problem) => `✖ ${problem}`).join('\n'));
      }
      return result.data;
    },
    write(value) {
      requireShallow(name, value);
      const result = z.safeEncode(body, value);
      if (!result.success) {
        throw invalid(name, z.prettifyError(result.error));
      }
      const text = encodeJson({ format: name, version, body: result.data });
      return { text, hash: contentHash(text) };
    },
    readKeyed: (text) => ({ value: persisted.read(text), text, hash: contentHash(text) }),
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
