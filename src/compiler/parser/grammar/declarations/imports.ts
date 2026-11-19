/**
 * Imports (§13.1): `import a, b as c, * as m, * from 'path'`, or the same items in parentheses.
 * `from` is a keyword only here (§2.2), and the path must be a string literal.
 *
 * Parenthesized items are a bracketed list (recovery.ts), so a line break separates them as a `,`
 * does (§2.1) and the list may span lines; `*` first on a line starts an item. Bare items stay on the import's line, which a line break
 * ends, so a long import is written in parentheses.
 *
 * The names are read so that the path is too while they are still being written, which is when
 * an editor asks what the module exports: `from` ends the list wherever a path follows it, a name
 * missing before it or not (`import from 'm'`, `import a, from 'm'`), and a keyword standing for a
 * name, as one being typed may spell (`import in from 'm'`), is reported and passed over.
 */

import type {
  ImportDeclaration,
  ImportedName,
  ImportItem,
} from '../../../syntax/declarations/index.ts';
import type { StringLiteral } from '../../../syntax/expressions/literals/literals.ts';
import { isKeyword } from '../../../syntax/tokens/index.ts';
import { type Identifier, isMissingName, type Missing } from '../../../syntax/tree/node.ts';
import type { CursorKind } from '../../cursor/index.ts';
import { parseDelimited } from '../../cursor/recovery.ts';
import type { Parser } from '../../parser.ts';

export function parseImport(parser: Parser): ImportDeclaration {
  const { cursor } = parser;
  const { start } = cursor.advance().span;
  const isParenthesized = cursor.at('(');
  const items = isParenthesized
    ? parseDelimited(parser, '(', () => parseImportItem(parser), importItemOpeners).items
    : parseBareItems(parser);
  const path = parseFrom(parser);
  return { kind: 'ImportDeclaration', span: parser.spanFrom(start), items, isParenthesized, path };
}

/** `*` opens an item on a new line, though `* as m` reads elsewhere as a multiplication (§2.1). */
const importItemOpeners: ReadonlySet<CursorKind> = new Set(['*']);

/** `a, * as m` on the import's line. */
function parseBareItems(parser: Parser): readonly ImportItem[] {
  const items = [parseImportItem(parser)];
  while (parser.cursor.eat(',') !== undefined) {
    items.push(parseImportItem(parser));
  }
  return items;
}

/** `*`, `* as m`, `a`, or `a as b`: every export, the namespace, or one export and its binding. */
function parseImportItem(parser: Parser): ImportItem {
  const star = parser.cursor.eat('*');
  if (star === undefined) {
    return parseImportedName(parser);
  }
  if (parser.cursor.eat('as') === undefined) {
    return { kind: 'ImportedAll', span: parser.anchor(star.span) };
  }
  const alias = parser.identifier('a namespace name');
  return { kind: 'ImportedNamespace', span: parser.spanFrom(star.span.start), alias };
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
