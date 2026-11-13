/**
 * What an operand may start with (§4): the visible names that are values or begin one, and the
 * words an operand starts with in the body around it (words.ts). A type begins a literal or a
 * static call and a namespace qualifies a name, so both stay; a trait names no value. A variant
 * stands bare only where its enum is expected (§3.11, expected.ts).
 *
 * Every place where an expression starts offers this, a call's argument and a one-field struct
 * literal's unnamed value included, so the rule has one home.
 */

import type { Entity } from '../../../../../compiler/binder/entities.ts';
import { nodesAt } from '../../../../../compiler/syntax/tree/index.ts';
import type { Candidate } from '../../candidate.ts';
import type { Cursor } from '../../cursor.ts';
import { expectedLiterals, expectedVariants, isBareVariant } from '../../expected.ts';
import type { ParsedPlace } from '../../placeholder.ts';
import { visibleNames } from '../../visible.ts';
import type { LiteralFieldPlace } from '../literal-field.ts';
import { type Surroundings, surroundingsOf } from './surroundings.ts';
import { operandWordsIn, wordCandidates } from './words.ts';

/**
 * What an expression written at `place` may start with: where a placeholder parses, in the body it
 * finds around it; at a literal's field, in the body around the literal as written.
 */
export function expressionCandidates(
  cursor: Cursor,
  place: ParsedPlace | LiteralFieldPlace,
): readonly Candidate[] {
  const surroundings =
    place.kind === 'literalField'
      ? surroundingsOf(cursor.tree, nodesAt(cursor.tree, cursor.offset))
      : surroundingsOf(place.parsed.tree, place.parsed.chain);
  return operandCandidates(cursor, place, surroundings);
}

/**
 * What an operand written at `place` may start with, in a body of the kind `surroundings` gives.
 */
export function operandCandidates(
  cursor: Cursor,
  place: ParsedPlace | LiteralFieldPlace,
  surroundings: Surroundings,
): readonly Candidate[] {
  return [
    ...operandNames(cursor),
    ...expectedVariants(cursor, place),
    ...expectedLiterals(cursor, place),
    ...wordCandidates(operandWordsIn(surroundings)),
  ];
}

/**
 * The visible names an operand may start with, whatever is expected of it: what a deferred call's
 * call starts with too (§3.14).
 */
export function operandNames(cursor: Cursor): readonly Candidate[] {
  return visibleNames(cursor, namesValue).filter((candidate) => !isBareVariant(candidate));
}

function namesValue(entity: Entity): boolean {
  return entity.kind !== 'type' || entity.declaration.kind !== 'TraitDeclaration';
}
