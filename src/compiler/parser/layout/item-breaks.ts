/**
 * Where a line break separates two items of a bracketed list (§2): the rule's one home.
 *
 * Inside a list (cursor/regions.ts) the cursor reads past line breaks, as inside any bracket, so
 * an item spans lines freely. A break separates two items, as a `,` does, where both hold:
 * - the list's current item could end there. The parser asks only where it would take a `,` or
 *   the closer next: after an operand, in the loops that extend one (an expression's infix and
 *   postfix operators, a type's and a pattern's), and in the list itself. After an operator, a
 *   `.`, a `:` or an opening bracket nothing asks, so the break is read past;
 * - the next line's first token can start an item. That is derived from the expression grammar's
 *   tables (expressions/expression.ts, `startsItemOnNewLine`) and the item parsers' openers (a
 *   spread's, a struct comprehension's, an annotated entry's), never listed here. A token both
 *   starting and continuing an operand starts an item when it would apply to the operand only on
 *   the operand's line (a postfix bracket), when it is a word not spelling an operator with the
 *   token after it (`not`, against `not in`), or when it is glued to what follows it (`-1`,
 *   against `- 1`).
 * Comments and blank lines change nothing: the decision reads the break's two tokens.
 *
 * A postfix bracket, `(`, `[`, `{` or type arguments' `<`, attaches only to an operand on its own
 * line (`atPostfix`): on the next line it starts an item, or for `<`, continues as the operator.
 * Outside lists none of this applies: blocks decide line breaks by their columns (index.ts), and
 * `${…}` and other brackets read past them.
 */

import { annotationOpener } from '../annotations.ts';
import type { CursorKind } from '../cursor/index.ts';
import type { Parser } from '../parser.ts';

/**
 * Whether the line break before the token `ahead` positions on separates two items of the
 * enclosing list, where an item could end: the token starts a line and can start an item.
 */
export function breakSeparatesItems(parser: Parser, ahead = 0): boolean {
  const { cursor } = parser;
  if (!cursor.startsLineInList(ahead)) {
    return false;
  }
  const token = cursor.peek(ahead);
  const next = cursor.peek(ahead + 1);
  const glued = next.span.start === token.span.end;
  return (
    token.kind === annotationOpener || parser.startsItemOnNewLine(token.kind, next.kind, glued)
  );
}

/** Whether `kind` comes next as a postfix bracket of the operand before it: on that line. */
export function atPostfix(parser: Parser, kind: CursorKind): boolean {
  return parser.cursor.at(kind) && !parser.cursor.startsLineInList();
}
