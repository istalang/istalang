/**
 * What an operand may start with (§4): the visible names that are values or begin one, and the
 * words an operand starts with in the body around it (words.ts). A type begins a literal or a
 * static call and a namespace qualifies a name, so both stay; a trait names no value. A variant
 * stands bare only where its enum is expected (§3.11, expected.ts).
 *
 * Every place where an expression starts offers this, a call's argument included, so the rule
 * has one home.
 */

import type { Entity } from '../../../../compiler/binder/entities.ts';
import type { Candidate } from '../../candidate.ts';
import type { Cursor } from '../../cursor.ts';
import { expectedLiterals, expectedVariants, isBareVariant } from '../../expected.ts';
import type { ParsedPlace } from '../../placeholder.ts';
import { visibleNames } from '../../visible.ts';
import { type Surroundings, surroundingsOf } from './surroundings.ts';
import { operandWordsIn, wordCandidates } from './words.ts';

/** What an expression written at `place` may start with. */
export function expressionCandidates(cursor: Cursor, place: ParsedPlace): readonly Candidate[] {
  const { parsed } = place;
  return operandCandidates(cursor, place, surroundingsOf(parsed.tree, parsed.chain));
}

/**
 * What an operand written at `place` may start with, in a body of the kind `surroundings` gives.
 */
export function operandCandidates(
  cursor: Cursor,
  place: ParsedPlace,
  surroundings: Surroundings,
): readonly Candidate[] {
  return [
    ...visibleNames(cursor, namesValue).filter((candidate) => !isBareVariant(candidate)),
    ...expectedVariants(cursor, place),
    ...expectedLiterals(cursor, place),
    ...wordCandidates(operandWordsIn(surroundings)),
  ];
}

function namesValue(entity: Entity): boolean {
  return entity.kind !== 'type' || entity.declaration.kind !== 'TraitDeclaration';
}
