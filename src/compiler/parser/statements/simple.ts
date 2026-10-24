/**
 * Statements made of a keyword and at most one expression (§4, §7, §9): `return`, `break`,
 * `continue`, `defer`, `drop` and `spawn`.
 *
 * `return` takes a value only when an expression follows on its line, so `if x: return` and a
 * bare `return` at the end of a line both return unit.
 */

import type { Expression } from '../../syntax/expressions.ts';
import type { Break, Continue, Defer, Drop, Return, Spawn } from '../../syntax/statements.ts';
import type { Parser } from '../parser.ts';

export function parseReturn(parser: Parser): Return {
  const { start } = parser.cursor.advance().span;
  const value = parser.startsExpression() ? parser.expression() : undefined;
  return { kind: 'Return', span: parser.spanFrom(start), value };
}

export function parseBreak(parser: Parser): Break {
  return { kind: 'Break', span: parser.cursor.advance().span };
}

export function parseContinue(parser: Parser): Continue {
  return { kind: 'Continue', span: parser.cursor.advance().span };
}

export function parseDefer(parser: Parser): Defer {
  const { start, operand } = parseKeywordAndOperand(parser);
  return { kind: 'Defer', span: parser.spanFrom(start), action: operand };
}

export function parseDrop(parser: Parser): Drop {
  const { start, operand } = parseKeywordAndOperand(parser);
  return { kind: 'Drop', span: parser.spanFrom(start), value: operand };
}

export function parseSpawn(parser: Parser): Spawn {
  const { start, operand } = parseKeywordAndOperand(parser);
  return { kind: 'Spawn', span: parser.spanFrom(start), call: operand };
}

function parseKeywordAndOperand(parser: Parser): { start: number; operand: Expression } {
  const { start } = parser.cursor.advance().span;
  return { start, operand: parser.expression() };
}
