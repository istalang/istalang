/**
 * Variable declarations (§3.4, §3.15): `let`, `const`, their destructuring forms, the forms whose
 * holdings last until the function ends or a named loop or block does (§7): `hold let`,
 * `hold const`, `hold _ = expr`, which means `hold const _ = expr`, and `hold(name) …`, and
 * `transient let`. Each modifier is read by its word, then the declaration as a plain one.
 *
 * An initializer is always required. A missing one is reported and stands as a Missing node.
 */

import { isUnnamed } from '../../../../foundation/language/naming.ts';
import type { Hold, VariableDeclaration } from '../../../syntax/statements/index.ts';
import type { Parser } from '../../parser.ts';
import { parseTargets } from '../parts/names.ts';
import { followsModifier } from '../word-parselets.ts';

/** What a modifier before `let` or `const` makes of the declaration. */
type Modified = Pick<VariableDeclaration, 'hold' | 'isTransient'>;

const unmodified: Modified = { hold: undefined, isTransient: false };

/** `let …` or `const …`, starting at the keyword. */
export function parseVariable(parser: Parser): VariableDeclaration {
  const { start } = parser.cursor.token.span;
  return parseVariableAfter(parser, start, unmodified);
}

/** Whether the `transient` at the cursor starts a transient variable: `transient let`. */
export function atTransient(parser: Parser): boolean {
  return followsModifier(parser, 'transient');
}

/** `transient let …`, starting at `transient`. */
export function parseTransientVariable(parser: Parser): VariableDeclaration {
  const { start } = parser.cursor.advance().span;
  return parseVariableAfter(parser, start, { ...unmodified, isTransient: true });
}

/** Whether a held variable's declaration starts `ahead` tokens on: `let`, `const`, or `_ =`. */
function startsHeldVariableAt(parser: Parser, ahead: number): boolean {
  const { cursor } = parser;
  const next = cursor.peek(ahead);
  return (
    followsModifier(parser, 'hold', ahead) ||
    (next.kind === 'identifier' &&
      isUnnamed(parser.textOf(next)) &&
      cursor.kindAt(ahead + 1) === '=')
  );
}

/** What `hold(name)` has between `hold` and the variable. */
const holdLabel = ['(', 'identifier', ')'] as const;

/** Whether the `hold` at the cursor, or `hold(name)`, starts a held variable. */
export function atHold(parser: Parser): boolean {
  const named = holdLabel.every((kind, index) => parser.cursor.kindAt(index + 1) === kind);
  return startsHeldVariableAt(parser, 1 + (named ? holdLabel.length : 0));
}

/** `hold …` or `hold(name) …`, starting at `hold`. */
export function parseHeldVariable(parser: Parser): VariableDeclaration {
  const { cursor } = parser;
  const { start } = cursor.advance().span;
  let label: Hold['label'];
  if (cursor.eat('(') !== undefined) {
    label = parser.identifier('a label or function name');
    parser.expect(')');
  }
  const hold: Hold = { kind: 'Hold', span: parser.spanFrom(start), label };
  return parseVariableAfter(parser, start, { ...unmodified, hold });
}

function parseVariableAfter(
  parser: Parser,
  start: number,
  modified: Modified,
): VariableDeclaration {
  const { cursor } = parser;
  const isMutable = cursor.eat('let') !== undefined;
  if (!isMutable) {
    cursor.eat('const');
  }
  const targets = parseTargets(parser);
  const type = cursor.eat(':') === undefined ? undefined : parser.type();
  const initializer = parser.expect('=') === undefined ? parser.placeholder() : parser.value(start);
  const span = parser.spanFrom(start);
  return {
    kind: 'VariableDeclaration',
    span,
    ...modified,
    isMutable,
    targets,
    type,
    initializer,
  };
}
