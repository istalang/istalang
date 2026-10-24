/**
 * Imports (§3.13): `import a, b from 'path'` and `import * as m from 'path'`. `from` is a keyword
 * only here (§2), and the path must be a string literal.
 */

import type { ImportDeclaration } from '../../syntax/declarations.ts';
import type { StringLiteral } from '../../syntax/expressions.ts';
import type { Missing } from '../../syntax/node.ts';
import type { Parser } from '../parser.ts';
import { parseNames } from '../parts/names.ts';

export function parseImport(parser: Parser): ImportDeclaration {
  const { cursor } = parser;
  const { start } = cursor.advance().span;
  if (cursor.eat('*') !== undefined) {
    parser.expect('as');
    const alias = parser.identifier('a namespace name');
    const path = parseFrom(parser);
    return { kind: 'NamespaceImport', span: parser.spanFrom(start), alias, path };
  }
  const names = parseNames(parser, 'a name to import');
  const path = parseFrom(parser);
  return { kind: 'NamedImport', span: parser.spanFrom(start), names, path };
}

/** `from 'path'`. */
function parseFrom(parser: Parser): StringLiteral | Missing {
  const { cursor } = parser;
  if (!(cursor.at('identifier') && parser.textOf(cursor.token) === 'from')) {
    return parser.missing("'from'");
  }
  cursor.advance();
  const token = cursor.eat('string');
  if (token?.kind !== 'string') {
    return parser.missing('a module path string');
  }
  return { kind: 'StringLiteral', span: token.span, value: token.value };
}
