/**
 * Variable declarations (§3.4, §3.15): `let`, `const`, their destructuring forms, and the forms
 * whose holdings last until the function ends or a named loop does (§7): `hold let`, `hold const`,
 * `hold _ = expr`, which means `hold const _ = expr`, and `hold(name) …`. `fn let`, `fn const` and
 * `fn _` are older spellings of the unnamed `hold`, read into the same tree.
 *
 * An initializer is always required. A missing one is reported and stands as a Missing node.
 */

import type { Hold, VariableDeclaration } from '../../syntax/statements.ts';
import type { Parser } from '../parser.ts';
import { parseTargets } from '../parts/names.ts';

/** `let …` or `const …`, starting at the keyword. */
export function parseVariable(parser: Parser): VariableDeclaration {
  const { start } = parser.cursor.token.span;
  return parseVariableAfter(parser, start, undefined);
}

/**
 * Whether a held variable's declaration starts `ahead` tokens on: `let`, `const`, or `_ =`.
 */
export function startsHeldVariableAt(parser: Parser, ahead: number): boolean {
  const { cursor } = parser;
  const next = cursor.peek(ahead);
  return (
    next.kind === 'let' ||
    next.kind === 'const' ||
    (next.kind === 'identifier' && parser.textOf(next) === '_' && cursor.kindAt(ahead + 1) === '=')
  );
}

/** What `hold(name)` has between `hold` and the variable. */
const holdLabel = ['(', 'identifier', ')'] as const;

/** Whether `hold` or `hold(name)` starts a held variable at the cursor. */
export function atHold(parser: Parser): boolean {
  if (!parser.atWord('hold')) {
    return false;
  }
  const named = holdLabel.every((kind, index) => parser.cursor.kindAt(index + 1) === kind);
  return startsHeldVariableAt(parser, 1 + (named ? holdLabel.length : 0));
}

/** `hold …` or `hold(name) …`, starting at `hold`. */
export function parseHeldVariable(parser: Parser): VariableDeclaration {
  const { cursor } = parser;
  const { start } = cursor.advance().span;
  let label: Hold['label'];
  if (cursor.eat('(') !== undefined) {
    label = parser.identifier('a loop or function name');
    parser.expect(')');
  }
  const hold: Hold = { kind: 'Hold', span: parser.spanFrom(start), label };
  return parseVariableAfter(parser, start, hold);
}

/** `fn let …`, `fn const …` or `fn _ = …`, starting at `fn`. */
export function parseFunctionHeldVariable(parser: Parser): VariableDeclaration {
  const { span } = parser.cursor.advance();
  return parseVariableAfter(parser, span.start, { kind: 'Hold', span, label: undefined });
}

function parseVariableAfter(
  parser: Parser,
  start: number,
  hold: Hold | undefined,
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
    hold,
    isMutable,
    targets,
    type,
    initializer,
  };
}
