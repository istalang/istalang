/**
 * Imports (§3.13): `import a, b from 'path'` and `import * as m from 'path'`. `from` is a keyword
 * only here (§2), and the path must be a string literal.
 *
 * The names are read so that the path is too while they are still being written, which is when
 * an editor asks what the module exports: `from` ends the list wherever a path follows it, a name
 * missing before it or not (`import from 'm'`, `import a, from 'm'`), and a keyword standing for a
 * name, as one being typed may spell (`import in from 'm'`), is reported and passed over.
 */

import type { ImportDeclaration } from '../../syntax/declarations.ts';
import type { StringLiteral } from '../../syntax/expressions/literals.ts';
import { type Identifier, isMissingName, type Missing } from '../../syntax/node.ts';
import { isKeyword } from '../../syntax/tokens.ts';
import type { Parser } from '../parser.ts';

export function parseImport(parser: Parser): ImportDeclaration {
  const { cursor } = parser;
  const { start } = cursor.advance().span;
  if (cursor.eat('*') !== undefined) {
    parser.expect('as');
    const alias = parser.identifier('a namespace name');
    const path = parseFrom(parser);
    return { kind: 'NamespaceImport', span: parser.spanFrom(start), alias, path };
  }
  const names = [importedName(parser)];
  while (parser.cursor.eat(',') !== undefined) {
    names.push(importedName(parser));
  }
  const path = parseFrom(parser);
  return { kind: 'NamedImport', span: parser.spanFrom(start), names, path };
}

function importedName(parser: Parser): Identifier {
  const what = 'a name to import';
  if (parser.atWord('from') && parser.cursor.kindAt(1) === 'string') {
    const { span } = parser.missing(what);
    return { kind: 'Identifier', span, text: '' };
  }
  const name = parser.identifier(what);
  if (isMissingName(name) && isKeyword(parser.cursor.kind)) {
    parser.cursor.advance();
  }
  return name;
}

/** `from 'path'`. */
function parseFrom(parser: Parser): StringLiteral | Missing {
  const { cursor } = parser;
  if (!parser.atWord('from')) {
    return parser.missing("'from'");
  }
  cursor.advance();
  const token = cursor.eat('string');
  if (token?.kind !== 'string') {
    return parser.missing('a module path string');
  }
  return { kind: 'StringLiteral', span: parser.anchor(token.span), value: token.value };
}
