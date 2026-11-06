/**
 * Imports (§3.13): `import a, b as c from 'path'`, the same names in parentheses, and
 * `import * as m from 'path'`. `from` is a keyword only here (§2), and the path must be a string
 * literal.
 *
 * Parenthesized names are a bracketed list (recovery.ts), so a line break separates them as a `,`
 * does (§2) and the list may span lines. Bare names stay on the import's line, which a line break
 * ends, so a long import is written in parentheses.
 *
 * The names are read so that the path is too while they are still being written, which is when
 * an editor asks what the module exports: `from` ends the list wherever a path follows it, a name
 * missing before it or not (`import from 'm'`, `import a, from 'm'`), and a keyword standing for a
 * name, as one being typed may spell (`import in from 'm'`), is reported and passed over.
 */

import type { ImportDeclaration, ImportedName } from '../../syntax/declarations/index.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import { type Identifier, type Invalid, isMissingName, type Missing } from '../../syntax/node.ts';
import { isKeyword } from '../../syntax/tokens.ts';
import { parseDelimited } from '../brackets/recovery.ts';
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
  const isParenthesized = cursor.at('(');
  const names = isParenthesized
    ? parseDelimited(parser, '(', () => parseImportedName(parser)).items
    : parseBareNames(parser);
  const path = parseFrom(parser);
  return { kind: 'NamedImport', span: parser.spanFrom(start), names, isParenthesized, path };
}

/** `a, b as c` on the import's line. */
function parseBareNames(parser: Parser): readonly (ImportedName | Invalid)[] {
  const names = [parseImportedName(parser)];
  while (parser.cursor.eat(',') !== undefined) {
    names.push(parseImportedName(parser));
  }
  return names;
}

/** `a`, or `a as b`: an export, and the name it is bound as where it is renamed. */
function parseImportedName(parser: Parser): ImportedName {
  const name = exportedName(parser);
  const alias =
    parser.cursor.eat('as') === undefined ? undefined : parser.identifier('a name to bind');
  return { kind: 'ImportedName', span: parser.spanFrom(parser.startOf(name)), name, alias };
}

function exportedName(parser: Parser): Identifier {
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
