/**
 * Definitions a compiler would never write, for tests of what refuses or catches them: a compiled
 * Definition's text with its body edited as plain JSON, which reading it validates afresh.
 */

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
