/**
 * The words each kind of grammar position admits, among the reserved and contextual words (§2), so
 * a position offers what the parser takes there and never every keyword: a module item's start,
 * a block item's start, an operand's start, and what goes on after an operand.
 *
 * The parser dispatches on these words in tables of its own (parser/declarations/declaration.ts,
 * statements/statement.ts, expressions/expression.ts), which a folder's internals keep from
 * completion; the scenario tests pin both directions, what each position must and must not offer.
 * The words after an operand come from the operator table (syntax/operators.ts), the contract the
 * parser builds its operators from.
 */

import { binaryOperators } from '../../../compiler/syntax/operators.ts';
import { type ContextualWord, isKeyword, type Keyword } from '../../../compiler/syntax/tokens.ts';
import type { Candidate } from '../candidate.ts';

export type Word = Keyword | ContextualWord;

/** A module's items (§3): the declarations, and the two items a block may hold too, `fn` and `const`. */
export const declarationWords: readonly Word[] = [
  'fn',
  'async',
  'struct',
  'enum',
  'trait',
  'import',
  'extern',
  'type',
  'shared',
  'const',
];

/** A block's items besides an expression (§3.4, §4, §7); `break` and `continue` need a loop. */
export const statementWords: readonly Word[] = [
  'let',
  'const',
  'for',
  'while',
  'return',
  'defer',
  'drop',
  'hold',
];

export const loopWords: readonly Word[] = ['break', 'continue'];

/** What goes on after an `if` chain's last block, while it has no `else`. */
export const ifClauseWords: readonly Word[] = ['elif', 'else'];

/** What an operand starts with anywhere (§4): literals, `not`, lambdas, anonymous structs, branches. */
export const operandWords: readonly Word[] = [
  'true',
  'false',
  'none',
  'not',
  'fn',
  'async',
  'struct',
  'if',
  'match',
];

/**
 * What an operand starts with only in a function's body, where an instance runs: `select` waits,
 * `spawn` starts an instance (§8, §9), and `new` makes a shared struct, whose cell lives in an
 * instance (§3.18). A top-level constant and a default run none of them.
 */
export const runningOperandWords: readonly Word[] = ['select', 'spawn', 'new'];

/** In an async function's body only (§7). */
export const asyncOperandWords: readonly Word[] = ['await'];

/** The binary operators spelled as words (`not` starting `not in`), and `is` (§4). */
export const infixWords: readonly Word[] = [
  ...new Set(
    Object.keys(binaryOperators)
      .map((operator) => operator.split(' ')[0] ?? operator)
      .filter(isKeyword),
  ),
  'is',
];

/**
 * What each modifier is followed by, where it stands as one (grammar/position.ts):
 * `async fn`, `shared struct`, `hold let`, `sendable fn` in a type, `not in` after an operand.
 */
export const followers = {
  async: ['fn'],
  shared: ['struct'],
  hold: ['let', 'const'],
  sendable: ['fn', 'async'],
  not: ['in'],
} as const satisfies Record<string, readonly Word[]>;

export type Modifier = keyof typeof followers;

/** Words the language reserves where they stand: keywords, contextual words, a pattern's `_`. */
export function wordCandidates(words: readonly string[]): readonly Candidate[] {
  return words.map((word): Candidate => ({ name: word, subject: { kind: 'keyword' } }));
}
