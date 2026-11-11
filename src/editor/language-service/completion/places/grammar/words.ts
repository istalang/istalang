/**
 * What a grammar position offers of the words the parser dispatches on there
 * (syntax/tokens/grammar-words.ts, whose lists the parser's tables are keyed by): every one, but
 * where the code around gives it no meaning. The parser takes `await` in any body and `break` in
 * any block; only an async function's body waits (§7), and only a loop ends early (§4). So a word
 * the parser starts taking at a position is offered there with no edit here, unless it needs
 * surroundings, which `wordNeeds` says.
 *
 * The `if` chain's clauses are the `if`'s own words, which no position starts with.
 */

import {
  operandWords,
  statementWords,
  type Word,
} from '../../../../../compiler/syntax/tokens/grammar-words.ts';
import type { Candidate } from '../../candidate.ts';
import type { Surroundings } from './surroundings.ts';

/** Whether surroundings give a word meaning. */
type Need = (surroundings: Surroundings) => boolean;

/** Code that runs, where an instance may; a top-level constant's value runs in none. */
const runsInInstance: Need = ({ body }) => body !== 'none';

const waits: Need = ({ body }) => body === 'async';

const inLoop: Need = ({ scopes }) => scopes.some(({ kind }) => kind !== 'LabelledBlock');

/**
 * The words offered only where the code around gives them meaning: `select` waits (§8) and `new`
 * makes a shared struct, whose cell lives in an instance (§3.18); `await` waits in an async body
 * (§7); `break` and `continue` end a loop's turn (§4).
 */
export const wordNeeds: Readonly<Partial<Record<Word, Need>>> = {
  select: runsInInstance,
  new: runsInInstance,
  await: waits,
  break: inLoop,
  continue: inLoop,
};

/** What an operand starts with, in the code `surroundings` give. */
export function operandWordsIn(surroundings: Surroundings): readonly Word[] {
  return meaningfulIn(surroundings, operandWords);
}

const operandWordSet: ReadonlySet<Word> = new Set(operandWords);

/** What a block's item starts with besides what an operand does. */
export function statementWordsIn(surroundings: Surroundings): readonly Word[] {
  const statementOnly = statementWords.filter((word) => !operandWordSet.has(word));
  return meaningfulIn(surroundings, statementOnly);
}

function meaningfulIn(surroundings: Surroundings, words: readonly Word[]): readonly Word[] {
  return words.filter((word) => wordNeeds[word]?.(surroundings) ?? true);
}

/** What goes on after an `if` chain's last block, while it has no `else`. */
export const ifClauseWords: readonly Word[] = ['elif', 'else'];

/** Words the language reserves where they stand: keywords, contextual words, a pattern's `_`. */
export function wordCandidates(words: readonly string[]): readonly Candidate[] {
  return words.map((word): Candidate => ({ name: word, subject: { kind: 'keyword' } }));
}
