/**
 * Definitions edited for tests:
 *
 * - Ones a compiler would never write, for tests of what refuses or catches them: a compiled
 *   Definition's text with its body edited as plain JSON, which reading it validates afresh.
 * - What a Definition says apart from where its code stands in its sources, so two compiles of
 *   one program laid out differently compare alike.
 */

import type { Definition } from './definition.ts';
import { decodeJson, encodeJson } from './formats/codec.ts';

/** The JSON of a Definition's body, as far as these edits reach into it. */
interface EditableBody {
  readonly functions: { readonly name: string; mode?: string }[];
}

/** A code entry's change of mode: the entry named `name` of mode `from` (a start's wrapper shares its name). */
interface ModeChange {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

/** `text`, a Definition's, with one code entry's mode changed. */
export function withModeChanged(text: string, { name, from, to }: ModeChange): string {
  const envelope = decodeJson(text) as { readonly body: EditableBody };
  const entry = envelope.body.functions.find((each) => each.name === name && each.mode === from);
  if (entry === undefined) {
    throw new Error(`The Definition has no ${from} code entry named ${name}.`);
  }
  entry.mode = to;
  return encodeJson(envelope);
}

/** The fields that say where code stands in its module's text: an instruction's or entry's, a module's lines. */
const placeFields = new Set(['span', 'lineStarts']);

/** `part`, a Definition or any part of one, as plain data without its spans and line starts. */
export function withoutPlaces(part: Definition | unknown): unknown {
  if (Array.isArray(part)) {
    return part.map(withoutPlaces);
  }
  if (typeof part === 'object' && part !== null) {
    return Object.fromEntries(
      Object.entries(part).flatMap(([field, each]) =>
        placeFields.has(field) ? [] : [[field, withoutPlaces(each)]],
      ),
    );
  }
  return part;
}
