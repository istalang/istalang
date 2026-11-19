/**
 * Where a line break separates two items of a bracketed list (§2.1): the rule's one home.
 *
 * Inside a list (cursor/regions.ts) the cursor reads past line breaks, as inside any bracket, so
 * an item spans lines freely. A break separates two items, as a `,` does, where both hold:
 * - the list's current item could end there. The parser asks only where it would take a `,` or
 *   the closer next: after an operand, in the loops that extend one (an expression's infix and
 *   postfix operators, a type's and a pattern's), and in the list itself. After an operator, a
 *   `.`, a `:` or an opening bracket nothing asks, so the break is read past;
 * - the next line's first token can start an item. That is derived from the expression grammar's
 *   tables (grammar/expressions/expression.ts, `startsItemOnNewLine`), with a spread's and a struct
 *   comprehension's openers, and from the openers a list's own items start with, which its parser
 *   passes in (`itemOpeners`): an annotated entry's `@`, an import's `*`. None is listed here. A
 *   token both starting and continuing an operand starts an item when it would apply to the
 *   operand only on the operand's line (a postfix bracket), when it is a word not spelling an
 *   operator with the token after it (`not`, against `not in`), or when it is a symbol no space
 *   parts from the rest of its line: glued to what follows (`-1`, against `- 1`), or alone at its line's end (a lone
 *   `..`, the range open at both ends). So every line a broken list puts one item on reads back as
 *   that item.
 * Comments and blank lines change nothing: the decision reads the break's two tokens.
 *
 * An optional part after a complete item (`& B` after `any A` or a constraint, a range's end after
 * `a..`, a range pattern's) is the item's continuation too: it is taken only where the break
 * before it separates nothing (`continues`), so a new item on the next line is never read as it.
 *
 * A postfix bracket, `(`, `[`, `{` or type arguments' `<`, attaches only to an operand on its own
 * line (`atPostfix`): on the next line it starts an item, or for `<`, continues as the operator. A
 * deferred call's call follows its taker only on the taker's line, in any region (`onOperandLine`),
 * so a name on the next line of a list starts an item.
 * Outside lists none of this applies: blocks decide line breaks by their columns (index.ts), and
 * `${…}` and other brackets read past them.
 */

import type { Token, TokenKind } from '../../syntax/tokens/index.ts';
import type { CursorKind } from '../cursor/index.ts';
import type { Parser } from '../parser.ts';

/** The item openers of a list whose items start with nothing of their own. */
export const noItemOpeners: ReadonlySet<CursorKind> = new Set();

/**
 * Whether the line break before the token `ahead` positions on separates two items of the
 * enclosing list, where an item could end: the token starts a line and can start an item, by the
 * grammar's tables or as one of `itemOpeners`, the tokens only this list's items start with.
 */
export function breakSeparatesItems(
  parser: Parser,
  ahead = 0,
  itemOpeners: ReadonlySet<CursorKind> = noItemOpeners,
): boolean {
  const { cursor } = parser;
  if (!cursor.startsLineInList(ahead)) {
    return false;
  }
  const token = cursor.peek(ahead);
  const next = cursor.peek(ahead + 1);
  const spaced = next.kind !== 'lineBreak' && !next.firstOnLine && next.span.start > token.span.end;
  return itemOpeners.has(token.kind) || parser.startsItemOnNewLine(token.kind, next.kind, spaced);
}

/**
 * Whether the next token continues the current item: on its line, or past a break separating
 * nothing.
 */
export function continues(parser: Parser): boolean {
  return !breakSeparatesItems(parser);
}

/** Consumes `kind` where it continues the current item (`continues`), as an optional part of it. */
export function eatContinuing(parser: Parser, kind: TokenKind): Token | undefined {
  return continues(parser) ? parser.cursor.eat(kind) : undefined;
}

/** Whether `kind` comes next as a postfix bracket of the operand before it: on that line. */
export function atPostfix(parser: Parser, kind: CursorKind): boolean {
  return parser.cursor.at(kind) && !parser.cursor.startsLineInList();
}

/**
 * Whether `kind` comes next on the line the operand before it ends on, in any region: brackets read
 * past a line break, and so does a list, which `atPostfix` alone decides by. A deferred call's call
 * follows its taker only there (§6.5).
 */
export function onOperandLine(parser: Parser, kind: CursorKind): boolean {
  const { token } = parser.cursor;
  return token.kind !== 'lineBreak' && token.kind === kind && !token.firstOnLine;
}
