/**
 * What an editor offers to complete the name a cursor is on, or is about to start. A request is
 * answered in three steps, each with one home:
 * - the place the cursor is in, decided once (place.ts);
 * - what may be written there, by that place's provider, one per kind of place (`offers`);
 * - how each candidate shows, ranks and inserts (present.ts).
 *
 * A request made by typing a trigger character is answered only at the places it opens
 * (triggers.ts). The editor filters by what has been typed, so every candidate is offered whatever
 * the prefix.
 */

import type { ModuleId, Program } from '../../compiler/program/program.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import { checkedModule } from '../checked-module.ts';
import type { Candidate } from './candidate.ts';
import { type Cursor, cursorAt } from './cursor.ts';
import type { Completion } from './item.ts';
import { type Place, placeAt } from './place.ts';
import { offerAnnotation } from './places/annotation.ts';
import { offerCallArgument } from './places/call-argument.ts';
import { offerDeclaredName } from './places/declared-name.ts';
import { offerGrammar } from './places/grammar.ts';
import { offerImport } from './places/import.ts';
import { offerLiteralFields } from './places/literal-field.ts';
import { offerMembers } from './places/member.ts';
import { offerNothing } from './places/nothing.ts';
import { offerPattern } from './places/pattern.ts';
import { offerType } from './places/type.ts';
import { present } from './present.ts';
import { placesOpenedAt } from './triggers.ts';

/** The completions for the name at `offset` of `module`, asked for by typing `trigger`, if any. */
export function completionsAt(
  program: Program,
  module: ModuleId,
  offset: number,
  trigger?: string,
): readonly Completion[] {
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    return [];
  }
  const cursor = cursorAt(checked, offset, trigger);
  const opens = placesOpenedAt(cursor);
  if (opens === undefined) {
    return [];
  }
  const place = placeAt(cursor);
  // Typed, as Biome infers a call of the narrowed `opens` as never truthy.
  const opened: boolean = opens(place);
  return opened ? present(cursor, handlerOf(offers, place)(cursor, place)) : [];
}

/** What may be written at each kind of place; each kind's provider lives in places/. */
const offers: Handlers<Cursor, Place, [], readonly Candidate[]> = {
  member: offerMembers,
  literalField: offerLiteralFields,
  nothing: offerNothing,
  grammar: offerGrammar,
  type: offerType,
  declaredName: offerDeclaredName,
  callArgument: offerCallArgument,
  pattern: offerPattern,
  import: offerImport,
  annotation: offerAnnotation,
};
