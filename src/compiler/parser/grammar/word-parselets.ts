/**
 * Parselet tables keyed by the words a grammar position dispatches on
 * (syntax/tokens/grammar-words.ts), typed so a table and its position's list agree both ways: a
 * listed word with no parselet, or a parselet for a word the list lacks, fails to compile.
 * Completion offers the lists, so what a table takes is what completion offers, with no second list
 * to keep in step.
 *
 * - A keyword is a token kind of its own, so a position's keywords key its table by token kind,
 *   beside the starts that are no words (`StartParselets`).
 * - A contextual word is scanned as a name (§2.2), so a position's contextual words key a table of
 *   their own (`WordParselets`), read where a name stands. Each parselet declines, giving undefined
 *   before it consumes anything, where what follows makes the word a name.
 * - A modifier's lookahead reads the words that may follow it from the same contract
 *   (`followsModifier`).
 */

import { followers, type KeywordModifier, type Word } from '../../syntax/tokens/grammar-words.ts';
import type { ContextualWord, Keyword } from '../../syntax/tokens/index.ts';
import type { CursorKind } from '../cursor/index.ts';
import type { Parser } from '../parser.ts';

/**
 * A table by token kind holding a parselet for each of `Words`' keywords and for no other keyword.
 */
export type StartParselets<Words extends Word, Parselet> = {
  readonly [Kind in Extract<Words, Keyword>]: Parselet;
} & { readonly [Kind in Exclude<CursorKind, Keyword>]?: Parselet };

/** A table holding a parselet for each of `Words`' contextual words. */
export type WordParselets<Words extends Word, Parselet> = {
  readonly [Text in Extract<Words, ContextualWord>]: Parselet;
};

/** The parselet of the contextual word the cursor stands at, if `parselets` hold one. */
export function wordParseletAt<Text extends ContextualWord, Parselet>(
  parser: Parser,
  parselets: Readonly<Record<Text, Parselet>>,
): Parselet | undefined {
  if (!parser.cursor.at('identifier')) {
    return undefined;
  }
  const text = parser.textOf(parser.cursor.token);
  return Object.hasOwn(parselets, text) ? parselets[text as Text] : undefined;
}

/** Whether the token `ahead` tokens on is one `modifier` stands before. */
export function followsModifier(parser: Parser, modifier: KeywordModifier, ahead = 1): boolean {
  const words: readonly CursorKind[] = followers[modifier];
  return words.includes(parser.cursor.kindAt(ahead));
}
