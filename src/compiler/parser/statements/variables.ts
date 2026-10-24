/**
 * Variable declarations (§3.4, §3.15): `let`, `const`, their destructuring forms, and the
 * forms whose holdings last until the function ends: `fn let`, `fn const`, and `fn _ = expr`,
 * which means `fn const _ = expr`.
 *
 * An initializer is always required. A missing one is reported and stands as a Missing node.
 */

import type { VariableDeclaration } from '../../syntax/statements.ts';
import type { Parser } from '../parser.ts';
import { parseTargets } from '../parts/names.ts';

/** `let …` or `const …`, starting at the keyword. */
export function parseVariable(parser: Parser): VariableDeclaration {
  const { start } = parser.cursor.token.span;
  return parseVariableAfter(parser, start, false);
}

/** `fn let …`, `fn const …` or `fn _ = …`, starting at `fn`. */
export function parseFunctionHeldVariable(parser: Parser): VariableDeclaration {
  const { start } = parser.cursor.advance().span;
  return parseVariableAfter(parser, start, true);
}

function parseVariableAfter(
  parser: Parser,
  start: number,
  heldByFunction: boolean,
): VariableDeclaration {
  const { cursor } = parser;
  const isMutable = cursor.eat('let') !== undefined;
  if (!isMutable) {
    cursor.eat('const');
  }
  const targets = parseTargets(parser);
  const type = cursor.eat(':') === undefined ? undefined : parser.type();
  const initializer = parser.expect('=') === undefined ? parser.placeholder() : parser.expression();
  const span = parser.spanFrom(start);
  return {
    kind: 'VariableDeclaration',
    span,
    heldByFunction,
    isMutable,
    targets,
    type,
    initializer,
  };
}
