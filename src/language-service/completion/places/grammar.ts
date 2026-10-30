/**
 * What a `grammar` place offers: what the grammar admits at the position the cursor is in
 * (grammar/position.ts), never every keyword.
 *
 * - A block's item starts with a statement's word, `break` and `continue` in a loop, `elif` and
 *   `else` after an `if` chain still open, or whatever an operand starts with.
 * - `spawn` calls a function: a module's, a local one, or one a namespace qualifies (§9).
 * - `&` passes a place that may change: a `let` variable, or a reference parameter passing its
 *   caller's on (§3.7). A shared struct's cell or an element reached through others is left to the
 *   member list after the name.
 * - `break`, `continue` and `hold(` name a scope around the cursor by its label (§3.4, §4).
 */

import { type Entity, localFunctionOf } from '../../../compiler/binder/entities.ts';
import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import { operandCandidates } from '../grammar/expression.ts';
import { type GrammarPosition, grammarPositionAt } from '../grammar/position.ts';
import { ifClauseWords, loopWords, statementWords, wordCandidates } from '../grammar/words.ts';
import type { ParsedPlace } from '../placeholder.ts';
import { visibleNames } from '../visible.ts';

type GrammarPlace = Extract<ParsedPlace, { readonly kind: 'grammar' }>;

export function offerGrammar(cursor: Cursor, place: GrammarPlace): readonly Candidate[] {
  const position = grammarPositionAt(cursor, place);
  return handlerOf(byPosition, position)(cursor, position, place);
}

const byPosition: Handlers<Cursor, GrammarPosition, [place: GrammarPlace], readonly Candidate[]> = {
  words: (_cursor, { words }) => wordCandidates(words),
  statement: (cursor, { surroundings, continuesIf }, place) => [
    ...operandCandidates(cursor, place, surroundings),
    ...wordCandidates([
      ...statementWords,
      ...(surroundings.scopes.some(({ kind }) => kind !== 'LabelledBlock') ? loopWords : []),
      ...(continuesIf ? ifClauseWords : []),
    ]),
  ],
  operand: (cursor, { surroundings }, place) => operandCandidates(cursor, place, surroundings),
  spawned: (cursor) => visibleNames(cursor, isFunction),
  referenced: (cursor) => visibleNames(cursor, isChangeable),
  labels: (_cursor, { labels }) =>
    labels.map(({ text }): Candidate => ({ name: text, subject: { kind: 'label' } })),
};

function isFunction(entity: Entity): boolean {
  return (
    entity.kind === 'functions' ||
    entity.kind === 'namespace' ||
    (entity.kind === 'variable' && localFunctionOf(entity) !== undefined)
  );
}

/** A `let` variable, or a reference parameter, which passes the caller's place on (§3.4, §3.7). */
function isChangeable(entity: Entity): boolean {
  if (entity.kind !== 'variable') {
    return false;
  }
  const { owner } = entity;
  return (
    (owner.kind === 'VariableDeclaration' && owner.isMutable) ||
    (owner.kind === 'Parameter' && owner.type?.kind === 'ReferenceType')
  );
}
