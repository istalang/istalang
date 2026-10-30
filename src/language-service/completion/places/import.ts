/**
 * An import's place (§3.13): `import names from 'path'` or `import * as alias from 'path'`.
 *
 * - A name to import offers what the module the import's path names exports, less what the file
 *   already imports from it by name. Until the path is written the module is unknown, so nothing.
 * - Inside the path, the module paths that may continue what is written (module-paths.ts).
 * - After a name, the word `from`; after `*`, the word `as`; an alias is declared: nothing.
 *
 * The words between the parts are read from the import's tokens: the parser recovers `import a ‸`
 * as no import at all and `import * ‸` as one whose alias is being written, so its tree can't tell
 * them from a name or an alias. `from` is a contextual word, an identifier to the scanner: it is
 * the import's word where a name or an alias is right before it (`import from from 'm'` imports
 * `from`), and offered only right after a name or the alias, in an import that doesn't have it.
 */

import { programModule } from '../../../compiler/program/program.ts';
import type { ImportDeclaration } from '../../../compiler/syntax/declarations.ts';
import type { Identifier } from '../../../compiler/syntax/node.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import type { Token } from '../../../compiler/syntax/tokens.ts';
import type { SyntaxNode } from '../../../compiler/syntax/tree.ts';
import { codeTokensOf } from '../../tokens.ts';
import type { Candidate } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import type { ParsedPlace } from '../placeholder.ts';
import { modulePathsAt } from './module-paths.ts';

type ImportPlace = Extract<ParsedPlace, { readonly kind: 'import' }>;

export function offerImport(cursor: Cursor, { parsed }: ImportPlace): readonly Candidate[] {
  const statement = parsed.chain.find(isImportDeclaration);
  if (statement !== undefined && parsed.chain.at(-1) === statement.path) {
    const opening = spanIn(parsed.tree, statement.path.span).start;
    return modulePathsAt(cursor, cursor.tree.source.text.slice(opening + 1, cursor.offset));
  }
  const { before } = cursor;
  switch (before?.kind) {
    case 'import':
    case ',':
      return statement?.kind === 'NamedImport'
        ? importable(cursor, spanIn(parsed.tree, statement.span).start)
        : [];
    case '*':
      return [word('as')];
    case 'identifier':
      return awaitsFrom(cursor, before) ? [word('from')] : [];
    default:
      return [];
  }
}

function isImportDeclaration(node: SyntaxNode): node is ImportDeclaration {
  return node.kind === 'NamedImport' || node.kind === 'NamespaceImport';
}

/**
 * Whether `name`, the token before the cursor, is a name the import lists or its alias, and the
 * import, read to the end of its line, has no `from` yet but the one the cursor may be writing.
 */
function awaitsFrom({ tree, name: written }: Cursor, name: Token): boolean {
  const tokens = codeTokensOf(tree);
  const at = tokens.indexOf(name);
  const start = tokens.findLastIndex((token, index) => index <= at && token.kind === 'import');
  const end = tokens.findIndex((token, index) => index > start && token.firstOnLine);
  const statement = tokens.slice(start, end === -1 ? undefined : end);
  const isName = (index: number) =>
    tokens[index]?.kind === 'identifier' && namePrefixes.has(tokens[index - 1]?.kind ?? 'end');
  const isFrom = (token: Token, index: number) =>
    token !== written &&
    tree.source.text.slice(token.span.start, token.span.end) === 'from' &&
    isName(start + index - 1);
  return isName(at) && !statement.some(isFrom);
}

/** What a name the import lists, or its alias, comes right after. */
const namePrefixes: ReadonlySet<string> = new Set(['import', ',', 'as']);

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
        ? node.names.filter((each) => !isWritten(each)).map(({ text }) => text)
        : [],
    ),
  );
  return [...checker.bindings.exportsOf(imported)]
    .filter(([exported]) => !taken.has(exported))
    .map(
      ([exported, entity]): Candidate => ({ name: exported, subject: { kind: 'entity', entity } }),
    );
}
