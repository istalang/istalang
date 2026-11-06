/**
 * Statements made of a keyword and at most one expression or label (§4, §7): `return`, `break`,
 * `continue`, `defer` and `drop`.
 *
 * `return` takes a value only when an expression follows on its line, or an indented value on the
 * lines below, deeper than its own (§2); so `if x: return` and a bare `return` at the end of a line
 * with no deeper line below both return unit. `break` and `continue` take a label on their line.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../syntax/node.ts';
import type { Break, Continue, Defer, Drop, Return } from '../../../syntax/statements/index.ts';
import type { Parser } from '../../parser.ts';

export function parseReturn(parser: Parser): Return {
  const { start } = parser.cursor.advance().span;
  const value = returnsValue(parser, start) ? parser.value(start) : undefined;
  return { kind: 'Return', span: parser.spanFrom(start), value };
}

/** Whether a value follows the `return` at `start`: on its line, or indented below it. */
function returnsValue(parser: Parser, start: number): boolean {
  const next = parser.cursor.lineStart;
  return (
    parser.startsExpression() ||
    (next !== undefined && parser.columnOf(next) > parser.indentationAt(start))
  );
}

export function parseBreak(parser: Parser): Break {
  const { start } = parser.cursor.advance().span;
  const label = parseExitLabel(parser);
  return { kind: 'Break', span: parser.spanFrom(start), label };
}

export function parseContinue(parser: Parser): Continue {
  const { start } = parser.cursor.advance().span;
  const label = parseExitLabel(parser);
  return { kind: 'Continue', span: parser.spanFrom(start), label };
}

/** The label after `break` or `continue`, when one follows on its line. */
function parseExitLabel(parser: Parser): Identifier | undefined {
  return parser.cursor.at('identifier') ? parser.identifier('a label') : undefined;
}

export function parseDefer(parser: Parser): Defer {
  const { start, operand } = parseKeywordAndOperand(parser);
  return { kind: 'Defer', span: parser.spanFrom(start), action: operand };
}

export function parseDrop(parser: Parser): Drop {
  const { start, operand } = parseKeywordAndOperand(parser);
  return { kind: 'Drop', span: parser.spanFrom(start), value: operand };
}

function parseKeywordAndOperand(parser: Parser): { start: number; operand: Expression } {
  const { start } = parser.cursor.advance().span;
  return { start, operand: parser.expression() };
}
