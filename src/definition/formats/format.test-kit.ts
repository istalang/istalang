/**
 * Reading refused texts: tests assert on the message a reader gives, so they check both what is
 * wrong and where, without matching the whole text.
 */

import type { z } from 'zod';
import { decodeJson, encodeJson } from './codec.ts';
import { type Format, FormatError } from './format.ts';

/** A written text's JSON, open for editing: the envelope, with the body as plain JSON. */
export interface EditableText {
  format: unknown;
  version: unknown;
  body: Record<string, unknown>;
}

/** `value` as `format` writes it, its JSON changed by `edit`, as text. */
export function editedText<Body extends z.ZodType>(
  format: Format<Body>,
  value: z.output<Body>,
  edit: (text: EditableText) => void,
): string {
  const json = decodeJson(format.write(value).text) as EditableText;
  edit(json);
  return encodeJson(json);
}

/** The message `format` refuses `text` with; fails the test if `text` is accepted. */
export function refusalOf<Body extends z.ZodType>(format: Format<Body>, text: string): string {
  try {
    format.read(text);
  } catch (error) {
    if (error instanceof FormatError) {
      return error.message;
    }
    throw error;
  }
  throw new Error(`${format.name} accepted a text it should refuse.`);
}
