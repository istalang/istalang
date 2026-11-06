/**
 * An import's place (§3.13): `import names from 'path'`, the names in parentheses, or
 * `import * as alias from 'path'`.
 *
 * - A name to import offers what the module the import's path names exports, less what the file
 *   already imports from it by name, whatever alias it is bound as. Until the path is written the
 *   module is unknown, so nothing. In parentheses a name starts after `(`, a `,`, or on a line of
 *   its own, which a line break separates from the name before (§2).
 * - Inside the path, the module paths that may continue what is written (module-paths.ts).
 * - After a name or the closing `)`, the word `from`; after `*`, the word `as`; an alias, whether
 *   a namespace's or a renamed name's, is a new name: nothing.
 *
 * The words between the parts are read from the import's tokens: the parser recovers `import a ‸`
 * as no import at all and `import * ‸` as one whose alias is being written, so its tree can't tell
 * them from a name or an alias. `from` is a contextual word, an identifier to the scanner: it is
 * the import's word where a name or an alias is right before it (`import from from 'm'` imports
 * `from`), and offered only right after a name or the alias, in an import that doesn't have it.
 */

import { programModule } from '../../../../../compiler/program/program.ts';
import {
  type ImportDeclaration,
  importedNames,
  type NamedImport,
} from '../../../../../compiler/syntax/declarations/index.ts';
import type { Token } from '../../../../../compiler/syntax/tokens/index.ts';
import type { SyntaxNode } from '../../../../../compiler/syntax/tree/index.ts';
import type { Identifier } from '../../../../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../../../../compiler/syntax/tree/positions.ts';
import { lineStartAt } from '../../../../../foundation/text/line-map.ts';
import { codeTokensOf } from '../../../reading/tokens.ts';
import type { Candidate } from '../../candidate.ts';
import type { Cursor } from '../../cursor.ts';
import type { ParsedPlace } from '../../placeholder.ts';
import { modulePathsAt } from './module-paths.ts';

type ImportPlace = Extract<ParsedPlace, { readonly kind: 'import' }>;

export function offerImport(cursor: Cursor, { parsed }: ImportPlace): readonly Candidate[] {
  const statement = parsed.chain.find(isImportDeclaration);
  if (statement !== undefined && parsed.chain.at(-1) === statement.path) {
    const opening = spanIn(parsed.tree, statement.path.span).start;
    return modulePathsAt(cursor, cursor.tree.source.text.slice(opening + 1, cursor.offset));
  }
  const { before } = cursor;
  const listed = statement?.kind === 'NamedImport' ? statement : undefined;
  if (listed !== undefined && startsName(cursor, listed, before)) {
    return importable(cursor, spanIn(parsed.tree, listed.span).start);
  }
  switch (before?.kind) {
    case '*':
      return [word('as')];
    case 'identifier':
    case ')':
      return awaitsFrom(cursor, before) ? [word('from')] : [];
    default:
      return [];
  }
}

/**
 * Whether a name to import starts at the cursor: after `import` or a `,`, or, in parentheses,
 * after the `(` or on a line below the name before it.
 */
function startsName(cursor: Cursor, statement: NamedImport, before: Token | undefined): boolean {
  switch (before?.kind) {
    case 'import':
    case ',':
      return true;
    case '(':
      return statement.isParenthesized;
    case 'identifier':
      return statement.isParenthesized && !onCursorLine(cursor, before);
    default:
      return false;
  }
}

function isImportDeclaration(node: SyntaxNode): node is ImportDeclaration {
  return node.kind === 'NamedImport' || node.kind === 'NamespaceImport';
}

/** Whether `token` stands on the cursor's line. */
function onCursorLine({ tree, offset }: Cursor, token: Token): boolean {
  return lineStartAt(tree.source.text, token.span.start) === lineStartAt(tree.source.text, offset);
}

/**
 * Whether `last`, the token before the cursor, ends the import's names, a name the import lists,
 * its alias or the `)` closing them, and the import, read from there to the end of its line, has
 * no `from` yet but the one the cursor may be writing.
 */
function awaitsFrom({ tree, name: written }: Cursor, last: Token): boolean {
  const tokens = codeTokensOf(tree);
  const at = tokens.indexOf(last);
  const start = tokens.findLastIndex((token, index) => index <= at && token.kind === 'import');
  const end = tokens.findIndex((token, index) => index > at && token.firstOnLine);
  const rest = tokens.slice(at + 1, end === -1 ? undefined : end);
  const isFrom = (token: Token) =>
    token !== written && tree.source.text.slice(token.span.start, token.span.end) === 'from';
  return endsNames(tokens, start, at) && !rest.some(isFrom);
}

/**
 * Whether the token at `at` ends the names of the import starting at `start`: a name or an alias
 * right after one of `namePrefixes`, or the `)` of names in parentheses.
 */
function endsNames(tokens: readonly Token[], start: number, at: number): boolean {
  const before = tokens[at - 1]?.kind ?? 'end';
  switch (tokens[at]?.kind) {
    case 'identifier':
      return start >= 0 && namePrefixes.has(before);
    case ')':
      return start >= 0 && tokens[start + 1]?.kind === '(';
    default:
      return false;
  }
}

/** What a name the import lists, or its alias, comes right after. */
const namePrefixes: ReadonlySet<string> = new Set(['import', ',', 'as', '(']);

function word(name: 'as' | 'from'): Candidate {
  return { name, subject: { kind: 'keyword' } };
}

/**
 * What the module of the import starting at `start` exports and the file doesn't import by name
 * yet, the name being written aside. The module is the one the program loaded for the checked
 * tree's import there, which starts where the placeholder's does.
 */
function importable({ checker, module, tree, name }: Cursor, start: number): readonly Candidate[] {
  const { imports } = programModule(checker.program, module);
  const imported = [...imports].find(([node]) => spanIn(tree, node.span).start === start)?.[1];
  if (imported === undefined) {
    return [];
  }
  const isWritten = (identifier: Identifier) =>
    spanIn(tree, identifier.span).start === name?.span.start;
  const taken = new Set(
    [...imports].flatMap(([node, from]) =>
      from === imported && node.kind === 'NamedImport'
        ? importedNames(node)
            .map((each) => each.name)
            .filter((each) => !isWritten(each))
            .map(({ text }) => text)
        : [],
    ),
  );
  return [...checker.bindings.exportsOf(imported)]
    .filter(([exported]) => !taken.has(exported))
    .map(
      ([exported, entity]): Candidate => ({ name: exported, subject: { kind: 'entity', entity } }),
    );
}
