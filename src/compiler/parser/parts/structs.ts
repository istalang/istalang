/**
 * Pieces every struct construct shares: the `struct` keyword, which must open braces, and field
 * declarations. Struct types, struct literals and struct patterns all start with the keyword, and
 * struct types and declarations list fields the same way (§3.1).
 */

import type { Missing } from '../../syntax/node.ts';
import type { FieldDeclaration } from '../../syntax/types.ts';
import type { Parser } from '../parser.ts';

/** Consumes `struct`. If no `{` follows, reports it and returns the Missing node to use. */
export function skipStructKeyword(parser: Parser): Missing | undefined {
  parser.cursor.advance();
  return parser.cursor.at('{') ? undefined : parser.missing("'{' after 'struct'");
}

/** `name: Type`. */
export function parseField(parser: Parser): FieldDeclaration {
  const name = parser.identifier('a field name');
  const type = parser.expect(':') === undefined ? parser.placeholder() : parser.type();
  return { kind: 'FieldDeclaration', span: parser.spanFrom(name.span.start), name, type };
}
